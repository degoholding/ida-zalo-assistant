import type { RowDataPacket } from "mysql2";
import type { Principal } from "../../auth/principal.js";
import { ConversationType } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import {
  SEARCH_FROM, SEARCH_TIME_HINT, SEARCH_TIMEOUT_TEXT, buildSnippet, isFulltextCacheLimitError, isSearchTimeoutError, likeOnlyCondition,
  likeWindowStart, loadFulltextCapabilities, messageTextCondition, relevantIndexedFrom, searchLimiter, type SqlCondition,
} from "../../search/message-search.js";
import { loadIndexedFrom } from "../../search/message-search-index.js";
import { ApiError, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { parseListRequest, type ListSpec, type Operator, type SqlPart } from "./list-query.js";
import { combineWhere } from "./list-runner.js";
import { scopedWhere } from "./scope.js";

// Màn «Tìm tin» (phase 6 — N4, IDA câu 21): tìm theo từ khóa (chỉ mục toàn văn, xem src/search/message-search.ts) + lọc
// nhóm / người gửi / khoảng ngày. Phạm vi nhóm của người dùng áp như màn Hội thoại. Chưa gõ từ khóa thì không trả gì.
// Tự phân trang thay vì runList để mọi câu (đếm + trang) có trần 5 giây và câu đếm dừng ở 1.000 (review 09/10/2026: đếm
// không trần trên lối quét LIKE đọc hết cửa sổ ngày, hai lần mỗi phím gõ).

const DAY_MS = 86_400_000;
/** Đếm tới đây thì dừng — màn hiện «1000+», khỏi đọc hết hàng chục nghìn tin chỉ để ra con số. */
export const MAX_COUNTED = 1000;

/** «2026-10-05» (ô chọn ngày) = 00:00 giờ Việt Nam ngày đó; chuỗi có giờ thì giữ nguyên. null = không đọc được. Hàm thuần. */
export function parseVnDayStart(raw: string): Date | null {
  const value = /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? new Date(`${raw.trim()}T00:00:00+07:00`) : new Date(raw);
  return Number.isNaN(value.getTime()) ? null : value;
}

/**
 * Lọc «Lúc gửi» theo NGÀY trên cột giờ có mili giây: «đúng ngày» = cả ngày, «≤ ngày» = hết ngày đó, «> ngày» = từ ngày sau.
 * So thẳng `sent_at = '2026-10-05 00:00:00.000'` thì gần như không bao giờ khớp. Hàm thuần.
 */
export function buildSentAtCondition(operator: Operator, values: string[]): SqlPart | null {
  const days = values.map(parseVnDayStart);
  const [first, second] = days;
  if (!first) return null;
  const next = (day: Date) => new Date(day.getTime() + DAY_MS);
  switch (operator) {
    case "eq": return { sql: "(s.sent_at >= ? AND s.sent_at < ?)", params: [first, next(first)] };
    case "ne": return { sql: "(s.sent_at < ? OR s.sent_at >= ?)", params: [first, next(first)] };
    case "gte": return { sql: "s.sent_at >= ?", params: [first] };
    case "gt": return { sql: "s.sent_at >= ?", params: [next(first)] };
    case "lte": return { sql: "s.sent_at < ?", params: [next(first)] };
    case "lt": return { sql: "s.sent_at < ?", params: [first] };
    case "between": return second ? { sql: "(s.sent_at >= ? AND s.sent_at < ?)", params: [first, next(second)] } : null;
    default: return null;
  }
}

/**
 * Khoảng ngày người tìm thật sự chọn ở «Lúc gửi» — để lối quét LIKE đặt cửa sổ: có «từ» (≥ / > / đúng ngày / trong khoảng)
 * thì không tự giới hạn; chỉ có «đến» (≤ / <) thì 90 ngày tính lùi từ mốc đó. Bộ lọc nối bằng HOẶC (conjunction=or) thì mốc
 * ngày không ràng được kết quả → coi như không chọn. Mốc «đến» là đầu ngày SAU ngày cuối được lấy. Hàm thuần.
 */
export function chosenDateRange(params: URLSearchParams): { from?: Date; to?: Date } {
  if (params.get("conjunction") === "or") return {};
  const day = (key: string, index = 0) => {
    const raw = params.get(key)?.split(",")[index];
    return (raw && parseVnDayStart(raw)) || undefined;
  };
  const next = (value: Date | undefined) => (value ? new Date(value.getTime() + DAY_MS) : undefined);
  return {
    from: day("sent_at__gte") ?? day("sent_at__eq") ?? day("sent_at__between") ?? next(day("sent_at__gt")),
    to: next(day("sent_at__lte")) ?? day("sent_at__lt") ?? next(day("sent_at__eq")) ?? next(day("sent_at__between", 1)),
  };
}

export const MESSAGE_SEARCH_SPEC: ListSpec = {
  fields: {
    group_id: { sql: "s.group_id", type: "number" },
    thread_type: { sql: "g.thread_type", type: "number" },
    sender_uid: { sql: "m.sender_uid", type: "text" },
    sender_name: { sql: "m.sender_name", type: "text" },
    kind: { sql: "m.kind", type: "number" },
    sent_at: { type: "date", build: buildSentAtCondition },
  },
  sorts: { sent_at: "s.sent_at" },
  defaultSort: { by: "sent_at", dir: "desc" },
  tieBreaker: "s.message_id",
};

const SELECT = `m.id, m.group_id AS thread_id, COALESCE(NULLIF(g.label, ''), g.name) AS thread_name, g.thread_type,
  m.sender_uid, m.sender_name, m.sent_at, m.kind, s.text`;
/** Cùng điều kiện với màn Hội thoại: nhóm đã tắt «Đọc tin» không hiện, tin cũ của nó cũng không tìm ra. */
const VISIBLE_THREADS = `(g.thread_type = ${ConversationType.Direct} OR g.read_messages = 1)`;

export async function searchMessagePage(db: Db, params: URLSearchParams, principal: Principal, now = new Date()): Promise<Record<string, unknown>> {
  const query = (params.get("q") ?? "").trim().slice(0, 200);
  const match = messageTextCondition(query, await loadFulltextCapabilities(db));
  if (!match) return { total: 0, items: [], took_ms: 0, window_from: null, indexed_from: null, total_capped: false };
  const started = Date.now();
  const request = parseListRequest(params, MESSAGE_SEARCH_SPEC);
  const chosen = chosenDateRange(params);
  const indexedFrom = relevantIndexedFrom(await loadIndexedFrom(db), chosen.from)?.toISOString() ?? null;
  const run = async (text: SqlCondition, lowerBound: Date | null) => {
    const window = lowerBound ? { sql: " AND s.sent_at >= ?", params: [lowerBound] } : { sql: "", params: [] };
    const base: SqlPart = {
      sql: `${text.sql} AND m.recalled_at IS NULL AND ${VISIBLE_THREADS}${window.sql}`, params: [...text.params, ...window.params],
    };
    // Phạm vi nhóm + mốc ngày nằm ở điều kiện CỐ ĐỊNH (combineWhere bọc ngoặc) — bộ lọc HOẶC của người dùng không thoát ra được
    const where = combineWhere(scopedWhere(principal, base, "s.group_id"), request.where);
    // Một lượt chỗ cho cả câu đếm + câu lấy trang — chung trần số câu tìm chạy cùng lúc với trợ lý (searchLimiter)
    const [[countRows], [rows]] = await searchLimiter.run(async () => [
      await db.query<RowDataPacket[]>(
        `SELECT ${SEARCH_TIME_HINT} COUNT(*) AS n FROM (SELECT 1 ${SEARCH_FROM} ${where.sql} LIMIT ${MAX_COUNTED + 1}) counted`, where.params),
      await db.query<RowDataPacket[]>(
        `SELECT ${SEARCH_TIME_HINT} ${SELECT} ${SEARCH_FROM} ${where.sql} ${request.orderSql} LIMIT ? OFFSET ?`,
        [...where.params, request.pageSize, request.offset]),
    ] as const);
    const counted = Number(countRows[0]?.n ?? 0);
    return {
      total: Math.min(counted, MAX_COUNTED),
      total_capped: counted > MAX_COUNTED,
      // Không trả cả nội dung tin (có thể rất dài) — chỉ đoạn trích quanh chỗ khớp
      items: rows.map(({ text, ...row }) => ({ ...row, snippet: buildSnippet(String(text ?? ""), query) })),
    };
  };
  // Lối quét LIKE (từ quá ngắn / MySQL chưa cấu hình / từ quá phổ biến): LUÔN có mốc ngày — người tìm chọn, không thì 90 ngày
  // tính lùi từ mốc «đến» (hoặc hôm nay). window_from = mốc tự đặt đó, để màn báo «chỉ tìm từ ngày …»
  const likeBound = likeWindowStart(chosen.from, chosen.to ?? now);
  const windowFrom = chosen.from ? null : likeBound.toISOString();
  const finish = async (text: SqlCondition, lowerBound: Date | null, window_from: string | null) =>
    ({ ...(await run(text, lowerBound)), took_ms: Date.now() - started, window_from, indexed_from: indexedFrom });
  try {
    if (!match.fulltext) return await finish(match, likeBound, windowFrom);
    try {
      return await finish(match, null, null);
    } catch (error) {
      if (!isFulltextCacheLimitError(error)) throw error;
      return await finish(likeOnlyCondition(query)!, likeBound, windowFrom);
    }
  } catch (error) {
    if (isSearchTimeoutError(error)) throw new ApiError(422, "search_too_broad", SEARCH_TIMEOUT_TEXT);
    throw error;
  }
}

export const messageSearchRoutes: ApiRoute[] = [
  ["GET", /^\/api\/messages\/search$/, async ({ response, url, service, principal }) =>
    sendOk(response, await searchMessagePage(service.db, url.searchParams, principal))],
];
