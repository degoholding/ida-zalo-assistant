// mcp-guard: legacy(files) — bản đọc SQL trực tiếp của «gợi ý trả lời» (đường hệ thống + họ `files` tắt); phase 13 chỉ giữ phần dùng chung với công cụ `reply_sources`
import type { RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";
import { loadReplySource } from "./reply-source-loader.js";
import { listApprovedTemplates } from "./reply-template-repository.js";
import type { ReplySourceReader } from "./reply-suggestion-types.js";

/** Số lần `suggest_replies` của liên hệ trong 1 giờ qua (đếm `assistant_turn`) — trần HOURLY_LIMIT của dịch vụ. */
export async function countSuggestionsLastHour(db: Db, contactId: number, now: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM assistant_turn
     WHERE contact_id = ? AND created_at >= ? AND JSON_CONTAINS(tool_calls, JSON_OBJECT('name', 'suggest_replies'))`,
    [contactId, new Date(now.getTime() - 3_600_000)]);
  return Number(rows[0]?.total ?? 0);
}

export function sqlReplySourceReader(db: Db): ReplySourceReader {
  return {
    hourlyCount: (contactId, now) => countSuggestionsLastHour(db, contactId, now),
    loadSource: (messageId, options) => loadReplySource(db, messageId, options),
    listApprovedTemplates: (tenantId) => listApprovedTemplates(db, tenantId),
  };
}
