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
    "get_group_messages quanh giờ đó. «Ai nhắc tới tôi / t / tao / em…», «ai tag tôi» (người hỏi tự nói về mình) → mentions_me = true, " +
    "không cần query (thêm query nếu hỏi kèm chủ đề).",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Từ khóa, vd 'công nợ Minh Phát' hoặc '\"hợp đồng thép\"'" },
      mentions_me: { type: "boolean", description: "true = chỉ tin có TAG (@) chính người đang hỏi — «ai nhắc tới tôi». Không truyền from thì xét 7 ngày gần nhất" },
      group: { type: "string", description: "Tên (một phần) nhóm cần tìm, bỏ trống = mọi nhóm" },
      person: { type: "string", description: "Tên (một phần) người gửi, bỏ trống = mọi người" },
      from: { type: "string", description: "Từ thời điểm, ISO 8601 có +07:00 (tùy chọn)" },
      to: { type: "string", description: "Đến thời điểm, ISO 8601 có +07:00 (tùy chọn)" },
      limit: { type: "integer", description: `Số tin tối đa, mặc định ${DEFAULT_LIMIT}, tối đa ${MAX_LIMIT}` },
    },
    required: [],
  },
};

const MENTION_DEFAULT_DAYS = 7;
const MENTION_MAX_DAYS = 90;

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

/**
 * «Ai nhắc tới tôi»: tin trong nhóm (đang đọc, không Mật) có TAG người hỏi (cột mentions), kèm từ khóa nếu có — không qua
 * bảng tìm toàn văn vì có thể không có từ khóa. Khoảng mặc định 7 ngày, tối đa 90 ngày (quét theo chỉ mục group_id + sent_at).
 */
async function searchMentions(
  context: { db: Db; scopeGroupId?: number; askerUid: string }, query: string, groupIds: number[] | undefined, from: Date, to: Date, limit: number,
): Promise<Record<string, unknown>> {
  const where = ["g.thread_type = ?", "g.read_messages = 1", "g.is_confidential = 0", "m.recalled_at IS NULL", "m.sent_at >= ?", "m.sent_at <= ?",
    "JSON_CONTAINS(COALESCE(m.mentions, JSON_ARRAY()), JSON_OBJECT('uid', ?))"];
  const params: unknown[] = [ConversationType.Group, from, to, context.askerUid];
  if (groupIds) {
    where.push("m.group_id IN (?)");
    params.push(groupIds);
  }
  for (const word of query.split(/\s+/).filter((item) => item.length >= 2).slice(0, 5)) {
    where.push("m.text LIKE ?");
    params.push(`%${word.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
  }
  const [rows] = await context.db.query<RowDataPacket[]>(
    `SELECT m.id, COALESCE(NULLIF(g.label, ''), g.name) AS group_name, m.sender_name, m.sent_at, m.text
     FROM message m JOIN zalo_group g ON g.id = m.group_id
     WHERE ${where.join(" AND ")} ORDER BY m.sent_at DESC LIMIT ?`, [...params, limit + 1]);
  const flat = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return {
    mentions_me: true,
    from_vn: formatVnTime(from.getTime()),
    to_vn: formatVnTime(to.getTime()),
    count: Math.min(rows.length, limit),
    more: rows.length > limit,
    results: rows.slice(0, limit).map((row) => ({
      message_id: Number(row.id), group: String(row.group_name ?? ""), sender: String(row.sender_name ?? ""),
      time_vn: formatVnTime(new Date(row.sent_at).getTime()), snippet: flat(row.text),
    })),
    ...(rows.length ? {} : { note: "Không có tin nào tag người hỏi trong khoảng này — có thể họ được nhắc bằng tên mà không tag: thử search_messages với query = tên người hỏi." }),
  };
}

export async function runSearchMessages(
  context: { db: Db; scopeGroupId?: number; askerUid: string; now?: Date },
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const mentionsMe = args.mentions_me === true || args.mentions_me === "true";
  if (!query && !mentionsMe) return { error: "Thiếu query (từ khóa cần tìm) — hoặc mentions_me = true để tìm tin nhắc tới người hỏi." };
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
  if (mentionsMe) {
    const until = to ?? context.now ?? new Date();
    const earliest = new Date(until.getTime() - MENTION_MAX_DAYS * 86_400_000);
    const since = from ?? new Date(until.getTime() - MENTION_DEFAULT_DAYS * 86_400_000);
    return searchMentions(context, query, groupIds, since < earliest ? earliest : since, until, limit);
  }
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
