import type { RowDataPacket } from "mysql2";
import { ConversationType } from "../../constants.js";
import { SEARCH_TIMEOUT_TEXT, SEARCH_TIME_HINT, isSearchTimeoutError, searchLimiter, searchMessages } from "../../search/message-search.js";
import { escapeLikeText } from "../../web/api/list-query.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError, translateDbError } from "../data-access-errors.js";
import { assertNoPersonalNumberProbe } from "../masked-filter-guard.js";
import { threadVisibilitySql } from "../visibility-guards.js";

// Lõi «tìm tin» dùng chung cho `search_messages` của cổng /mcp và của trợ lý: tìm theo từ khóa (chỉ mục toàn văn) HOẶC «ai nhắc (tag) tôi»,
// lọc theo tên nhóm / người gửi / khoảng ngày. MỘT chốt chặn: phạm vi nhóm + Mật + cuộc riêng của chính người hỏi đều từ ctx
// (`threadVisibilitySql`, `ctx.principal.groupIds`), chặn dò dãy ≥ 9 số khi bật che. Hai công cụ chỉ khác cách trình bày kết quả.

export const MISSING_QUERY_MESSAGE = "Thiếu query (từ khóa cần tìm) — hoặc mentions_me = true để tìm tin nhắc tới người hỏi.";
const MENTION_DEFAULT_DAYS = 7;
const MENTION_MAX_DAYS = 90;
const DAY_MS = 86_400_000;

export interface MessageSearchParams {
  query: string;
  mentionsMe: boolean;
  /** Tên (một phần) nhóm — mọi nhóm thấy được khớp tên (không đòi duy nhất). Bỏ qua khi hỏi trong nhóm. */
  groupName?: string;
  threadIds?: number[];
  senderName?: string;
  from?: Date;
  to?: Date;
  limit: number;
}

export interface MessageSearchHitView {
  messageId: number;
  threadId: number;
  threadName: string;
  senderName: string;
  sentAt: Date;
  snippet: string;
}

export interface MessageSearchOutcome {
  mentions: boolean;
  hits: MessageSearchHitView[];
  more: boolean;
  windowFrom: Date | null;
  indexedFrom: Date | null;
  /** Chỉ «ai nhắc tôi»: khoảng đã xét (mặc định 7 ngày, trần 90 ngày). */
  range?: { from: Date; to: Date };
}

/** Nhóm người hỏi thấy được khớp tên — để mô hình gõ «K52» thay vì phải biết id. */
export async function visibleGroupIdsByName(ctx: DataAccessContext, name: string): Promise<number[]> {
  const like = `%${escapeLikeText(name)}%`;
  const visible = threadVisibilitySql(ctx, "g");
  try {
    const [rows] = await ctx.db.query<RowDataPacket[]>(
      `SELECT g.id FROM zalo_group g WHERE g.thread_type = ? AND ${visible.sql} AND (g.name LIKE ? OR g.label LIKE ?)`,
      [ConversationType.Group, ...visible.params, like, like]);
    return rows.map((row) => Number(row.id));
  } catch (error) {
    return translateDbError(error);
  }
}

/** Uid người đang hỏi (cho «ai nhắc tôi»): liên hệ Zalo của lượt trợ lý, hoặc chủ cuộc riêng của ctx. */
export const askerUidOf = (ctx: DataAccessContext): string | null => ctx.contactActor?.uid ?? ctx.ownDirectUid ?? null;

/**
 * «Ai nhắc tới tôi»: tin trong nhóm (trong phạm vi) có TAG người hỏi (cột mentions), kèm từ khóa nếu có — không qua bảng tìm toàn văn vì có
 * thể không có từ khóa. Khoảng mặc định 7 ngày, tối đa 90 ngày (quét theo chỉ mục group_id + sent_at).
 */
async function searchMentions(ctx: DataAccessContext, params: MessageSearchParams, groupIds: number[] | undefined): Promise<MessageSearchOutcome> {
  const uid = askerUidOf(ctx);
  if (!uid) throw new DataAccessError("invalid_value", "Không xác định được người hỏi để tìm tin nhắc tới họ — dùng query (từ khóa) thay cho mentions_me.");
  const until = params.to ?? ctx.now;
  const earliest = new Date(until.getTime() - MENTION_MAX_DAYS * DAY_MS);
  const wanted = params.from ?? new Date(until.getTime() - MENTION_DEFAULT_DAYS * DAY_MS);
  const since = wanted < earliest ? earliest : wanted;
  if (groupIds && !groupIds.length) return { mentions: true, hits: [], more: false, windowFrom: null, indexedFrom: null, range: { from: since, to: until } };
  const visible = threadVisibilitySql(ctx, "g");
  const where = ["g.thread_type = ?", "m.recalled_at IS NULL", "m.sent_at >= ?", "m.sent_at <= ?",
    "JSON_CONTAINS(COALESCE(m.mentions, JSON_ARRAY()), JSON_OBJECT('uid', ?))", visible.sql];
  const values: unknown[] = [ConversationType.Group, since, until, uid, ...visible.params];
  if (groupIds) {
    where.push("m.group_id IN (?)");
    values.push(groupIds);
  }
  for (const word of params.query.split(/\s+/).filter((item) => item.length >= 2).slice(0, 5)) {
    where.push("m.text LIKE ?");
    values.push(`%${escapeLikeText(word)}%`);
  }
  // Lọc người gửi áp dụng thật (không bỏ qua im lặng): tên một phần, thoát ký tự đại diện
  const sender = params.senderName?.trim();
  if (sender) {
    where.push("m.sender_name LIKE ?");
    values.push(`%${escapeLikeText(sender)}%`);
  }
  let rows: RowDataPacket[];
  try {
    // Cùng trần số câu chạy đồng thời với câu tìm toàn văn + trần thời gian thực thi
    [rows] = await searchLimiter.run(() => ctx.db.query<RowDataPacket[]>(
      `SELECT ${SEARCH_TIME_HINT} m.id, m.group_id, COALESCE(NULLIF(g.label, ''), g.name) AS group_name, m.sender_name, m.sent_at, m.text
       FROM message m JOIN zalo_group g ON g.id = m.group_id
       WHERE ${where.join(" AND ")} ORDER BY m.sent_at DESC LIMIT ?`, [...values, params.limit + 1]));
  } catch (error) {
    return translateDbError(error);
  }
  const flat = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return {
    mentions: true, more: rows.length > params.limit, windowFrom: null, indexedFrom: null, range: { from: since, to: until },
    hits: rows.slice(0, params.limit).map((row) => ({
      messageId: Number(row.id), threadId: Number(row.group_id), threadName: String(row.group_name ?? ""), senderName: String(row.sender_name ?? ""),
      sentAt: new Date(row.sent_at), snippet: flat(row.text),
    })),
  };
}

export async function runMessageSearch(ctx: DataAccessContext, params: MessageSearchParams): Promise<MessageSearchOutcome> {
  if (!params.query && !params.mentionsMe) throw new DataAccessError("invalid_value", MISSING_QUERY_MESSAGE);
  // Che dữ liệu cá nhân bật: không cho dò SĐT / CCCD từng số qua câu tìm (BC2: nay áp cả cho trợ lý)
  assertNoPersonalNumberProbe(ctx, "query", params.query);
  // Giao danh sách cuộc người gọi chọn (hỏi trong nhóm = đúng nhóm đó; tên nhóm; thread_ids) với phạm vi được gán
  let chosen: number[] | undefined = ctx.groupScopeId !== undefined ? [ctx.groupScopeId] : params.threadIds;
  if (ctx.groupScopeId === undefined && params.groupName) {
    const byName = await visibleGroupIdsByName(ctx, params.groupName);
    if (!byName.length) throw new DataAccessError("not_found", `Không có nhóm nào đang đọc tên giống «${params.groupName}» — gọi list_groups để xem tên đúng.`);
    chosen = chosen ? chosen.filter((id) => byName.includes(id)) : byName;
  }
  const scope = ctx.principal.groupIds;
  const groupIds = chosen ? (scope ? chosen.filter((id) => scope.includes(id)) : chosen) : (scope ?? undefined);
  if (params.mentionsMe) return searchMentions(ctx, params, groupIds);
  let result;
  try {
    result = await searchMessages(ctx.db, {
      query: params.query, groupIds, excludeConfidential: !ctx.includeConfidential, onlyReadGroups: false, onlyReadableThreads: true,
      ownDirectThreads: ctx.ownDirectThreadsOnly ? { uid: ctx.ownDirectUid ?? null } : undefined, maskPersonal: ctx.maskPersonal,
      senderName: params.senderName, from: params.from, to: params.to, limit: params.limit + 1, now: ctx.now,
    });
  } catch (error) {
    if (isSearchTimeoutError(error)) throw new DataAccessError("timeout", SEARCH_TIMEOUT_TEXT);
    throw error;
  }
  return {
    mentions: false, more: result.hits.length > params.limit, windowFrom: result.windowFrom, indexedFrom: result.indexedFrom,
    hits: result.hits.slice(0, params.limit),
  };
}
