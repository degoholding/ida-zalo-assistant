import type { RowDataPacket } from "mysql2";
import { askerSourceVisibility, type AskerAccess } from "../assistant/asker-access.js";
import { andParts } from "../data-access/visibility-guards.js";
import type { Db } from "../db/pool.js";
import type { SqlPart } from "../web/api/list-query.js";

// Ai thấy ticket nào qua Zalo / trợ lý (phase 6, vá review): ticket gắn «nhóm nguồn» (source_thread_id) nên đi cùng luật nhóm.
// - Hỏi TRONG NHÓM: chỉ ticket của đúng nhóm đó (câu trả lời mọi thành viên đều đọc) — áp cho cả người báo lẫn người xử lý.
// - Tin riêng, người xử lý / quản lý xem ticket người khác: theo `access` — tài khoản web (và tài khoản đã tắt) đi qua luật nhóm +
//   Mật của lõi truy cập dữ liệu (cùng luật màn Ticket trên web); người chỉ suy từ vai trò / vai trò người nhận giữ phạm vi như
//   trước (mọi nhóm) nhưng KHÔNG thấy ticket của nhóm Mật.
// - Người báo luôn thấy ticket của chính mình trong tin riêng.

export interface TicketVisibilityInput {
  /** Hỏi trong nhóm: chỉ nhóm này. */
  scopeGroupId?: number;
  /** Ngữ cảnh truy cập của người hỏi (phân giải lười, một lần mỗi lượt). Không có = không lọc theo tài khoản (đường cũ / bài kiểm). */
  access?: () => Promise<AskerAccess>;
}

/** Điều kiện nhóm của lượt gọi trong nhóm (cột `t.source_thread_id`). */
export function groupScopePart(input: TicketVisibilityInput): SqlPart | undefined {
  return input.scopeGroupId ? { sql: "t.source_thread_id = ?", params: [input.scopeGroupId] } : undefined;
}

/** Điều kiện cho người xem ticket CỦA NGƯỜI KHÁC (bảng `ticket t` + LEFT JOIN `zalo_group g`). */
export async function overseerPart(input: TicketVisibilityInput): Promise<SqlPart | undefined> {
  const group = groupScopePart(input);
  if (!input.access) return group;
  const access = await input.access();
  return andParts(group, askerSourceVisibility(access, "t.source_thread_id", "g"));
}

/** Bọc điều kiện thành `AND id IN (...)` cho câu truy vấn bảng `ticket` không bí danh (không đổi cột đang chọn). */
export function visibilityClause(part: SqlPart | undefined): SqlPart {
  if (!part) return { sql: "", params: [] };
  return { sql: ` AND id IN (SELECT t.id FROM ticket t LEFT JOIN zalo_group g ON g.id = t.source_thread_id WHERE ${part.sql})`, params: part.params };
}

/** Ticket `ticketId` có thỏa điều kiện không (không có điều kiện = có). */
export async function isTicketVisible(db: Db, ticketId: number, part: SqlPart | undefined): Promise<boolean> {
  if (!part) return true;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM ticket t LEFT JOIN zalo_group g ON g.id = t.source_thread_id WHERE t.id = ? AND ${part.sql} LIMIT 1`, [ticketId, ...part.params]);
  return rows.length > 0;
}
