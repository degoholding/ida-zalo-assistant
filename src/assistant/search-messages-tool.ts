import type { RowDataPacket } from "mysql2";
import { ConversationType } from "../constants.js";
import type { Db } from "../db/pool.js";
import { LIKE_WINDOW_DAYS, SEARCH_TIMEOUT_TEXT, isSearchTimeoutError, searchMessages } from "../search/message-search.js";
import type { FunctionDeclaration } from "./gemini-client.js";
import { formatVnTime, parseVnTime } from "./group-action-tools.js";

// Công cụ search_messages (phase 6 — N4, IDA câu 21): tìm lại một trao đổi cũ theo từ khóa + nhóm + người + khoảng ngày,
// thay cho việc đọc lần lượt từng nhóm. Cùng phạm vi các công cụ khác: chỉ nhóm đang «Đọc tin», không bao giờ nhóm Mật;
// hỏi trong nhóm thì chỉ tìm trong nhóm đó (bỏ qua tham số group mô hình truyền).

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export const SEARCH_MESSAGES_DECLARATION: FunctionDeclaration = {
  name: "search_messages",
  description:
    "TÌM TIN NHẮN cũ theo TỪ KHÓA trong các nhóm (nhanh, không phải đọc cả nhóm): «tìm tin nói về công nợ Minh Phát», «ai nhắc tới " +
    "hợp đồng thép», «tuần trước X nói gì về giá». Trả về tin khớp mới nhất trước: nhóm, người gửi, giờ, đoạn trích. Từ khóa ngắn, " +
    "đúng chữ có trong tin (gõ không dấu cũng khớp); cụm cố định đặt trong ngoặc kép. Cần hiểu trước / sau một tin thì " +
    "get_group_messages quanh giờ đó.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Từ khóa, vd 'công nợ Minh Phát' hoặc '\"hợp đồng thép\"'" },
      group: { type: "string", description: "Tên (một phần) nhóm cần tìm, bỏ trống = mọi nhóm" },
      person: { type: "string", description: "Tên (một phần) người gửi, bỏ trống = mọi người" },
      from: { type: "string", description: "Từ thời điểm, ISO 8601 có +07:00 (tùy chọn)" },
      to: { type: "string", description: "Đến thời điểm, ISO 8601 có +07:00 (tùy chọn)" },
      limit: { type: "integer", description: `Số tin tối đa, mặc định ${DEFAULT_LIMIT}, tối đa ${MAX_LIMIT}` },
    },
    required: ["query"],
  },
};

/**
 * Mốc thời gian mô hình truyền: «2026-03-01» = đầu ngày (from) / cuối ngày (to) giờ Việt Nam; ISO đầy đủ thì đọc như công cụ
 * khác. undefined = không truyền; null = truyền mà sai (báo lại cho mô hình, không lặng lẽ bỏ qua). Hàm thuần.
 */
export function parseSearchBound(raw: unknown, edge: "start" | "end"): Date | undefined | null {
  if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) return undefined;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return new Date(`${raw.trim()}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}+07:00`);
  }
  const ms = parseVnTime(raw);
  return ms === null ? null : new Date(ms);
}

/** Nhóm (đang đọc, không Mật) khớp tên — để mô hình gõ «K52» thay vì phải biết id. */
async function resolveGroupIds(db: Db, name: string): Promise<number[]> {
  const like = `%${name.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM zalo_group WHERE thread_type = ? AND read_messages = 1 AND is_confidential = 0 AND (name LIKE ? OR label LIKE ?)`,
    [ConversationType.Group, like, like]);
  return rows.map((row) => Number(row.id));
}

export async function runSearchMessages(
  context: { db: Db; scopeGroupId?: number },
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { error: "Thiếu query (từ khóa cần tìm)." };
  const groupName = typeof args.group === "string" ? args.group.trim() : "";
  let groupIds: number[] | undefined;
  if (context.scopeGroupId) groupIds = [context.scopeGroupId];
  else if (groupName) {
    groupIds = await resolveGroupIds(context.db, groupName);
    if (!groupIds.length) return { error: `Không có nhóm nào đang đọc tên giống «${groupName}» — gọi list_groups để xem tên đúng.` };
  }
  const from = parseSearchBound(args.from, "start");
  const to = parseSearchBound(args.to, "end");
  if (from === null || to === null) return { error: "from / to sai định dạng — dùng ISO 8601 có +07:00 (vd 2026-10-01T00:00:00+07:00) hoặc ngày 2026-10-01." };
  const rawLimit = Number(args.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(MAX_LIMIT, Math.round(rawLimit)) : DEFAULT_LIMIT;
  let result: Awaited<ReturnType<typeof searchMessages>>;
  try {
    result = await searchMessages(context.db, {
      query, groupIds, excludeConfidential: true, onlyReadGroups: true, limit: limit + 1,
      senderName: typeof args.person === "string" ? args.person : undefined, from, to,
    });
  } catch (error) {
    if (isSearchTimeoutError(error)) return { error: SEARCH_TIMEOUT_TEXT };
    throw error;
  }
  const { hits, windowFrom, indexedFrom } = result;
  return {
    query,
    count: Math.min(hits.length, limit),
    more: hits.length > limit,
    results: hits.slice(0, limit).map((hit) => ({
      message_id: hit.messageId, group: hit.threadName, sender: hit.senderName, time_vn: formatVnTime(hit.sentAt.getTime()), snippet: hit.snippet,
    })),
    ...(windowFrom ? {
      searched_from_vn: formatVnTime(windowFrom.getTime()),
      window_note: `Chỉ tìm các tin từ ${formatVnTime(windowFrom.getTime())} trở đi (${LIKE_WINDOW_DAYS} ngày — từ khóa quá phổ biến / quá ngắn) — nói rõ với người hỏi; muốn xa hơn thì truyền from.`,
    } : {}),
    ...(indexedFrom ? {
      index_note: `Hệ thống đang chép tin cũ vào chỉ mục tìm — mới tìm được các tin từ khoảng ${formatVnTime(indexedFrom.getTime())} trở đi; ` +
        "tin cũ hơn có thể chưa ra — nói rõ với người hỏi, cần gấp thì đọc nhóm bằng get_group_messages.",
    } : {}),
    ...(hits.length ? {} : { note: "Không có tin nào khớp — thử từ khóa ngắn hơn / từ đồng nghĩa, hoặc nới khoảng thời gian." }),
  };
}
