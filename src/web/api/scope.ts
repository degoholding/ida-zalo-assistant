import type { RowDataPacket } from "mysql2";
import { groupScopeSql, type Principal } from "../../auth/principal.js";
import type { Db } from "../../db/pool.js";
import { ApiError } from "./api-http.js";
import type { SqlPart } from "./list-query.js";

// Phạm vi nhóm trên web (phase 4): người dùng không phải quản trị chỉ thấy nhóm được gán (user_group_scope), không thấy
// cuộc nhắn riêng với bot. Ngoài phạm vi thì trả 404 như không có — không để lộ «có mà không được xem».

const NOT_FOUND = () => new ApiError(404, "not_found", "Không tìm thấy bản ghi");

/** Ghép điều kiện phạm vi vào điều kiện gốc của một danh sách. `column` = cột id nhóm (zalo_group.id). */
export function scopedWhere(principal: Principal, base: SqlPart | undefined, column: string): SqlPart | undefined {
  const scope = groupScopeSql(principal, column);
  if (!scope) return base;
  // Điều kiện gốc của runList không mang chữ WHERE — nối bằng AND, bọc ngoặc hai vế
  return base ? { sql: `(${base.sql}) AND (${scope.sql})`, params: [...base.params, ...scope.params] } : scope;
}

/** Cuộc / nhóm phải nằm trong phạm vi, không thì 404. */
export function assertThreadVisible(principal: Principal, threadId: number): void {
  if (principal.groupIds !== null && !principal.groupIds.includes(threadId)) throw NOT_FOUND();
}

/** Tệp phải thuộc một cuộc trong phạm vi. */
export async function assertFileVisible(db: Db, principal: Principal, attachmentId: number): Promise<void> {
  if (principal.groupIds === null) return;
  const [rows] = await db.query<RowDataPacket[]>("SELECT group_id FROM attachment WHERE id = ?", [attachmentId]);
  if (!rows[0]) throw NOT_FOUND();
  assertThreadVisible(principal, Number(rows[0].group_id));
}

/** Điều kiện «người này ở ít nhất một nhóm trong phạm vi» cho bảng contact (alias c). */
export function contactScopeSql(principal: Principal): SqlPart | null {
  if (principal.groupIds === null) return null;
  if (!principal.groupIds.length) return { sql: "1 = 0", params: [] };
  return { sql: "EXISTS (SELECT 1 FROM group_member gm WHERE gm.zalo_uid = c.zalo_uid AND gm.group_id IN (?))", params: [principal.groupIds] };
}

/** Người (theo id Danh bạ hoặc mã Zalo) phải ở một nhóm trong phạm vi. */
export async function assertContactVisible(db: Db, principal: Principal, where: { id?: number; uid?: string }): Promise<void> {
  if (principal.groupIds === null) return;
  if (!principal.groupIds.length) throw NOT_FOUND();
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM contact c JOIN group_member gm ON gm.zalo_uid = c.zalo_uid
     WHERE ${where.id !== undefined ? "c.id = ?" : "c.zalo_uid = ?"} AND gm.group_id IN (?) LIMIT 1`,
    [where.id ?? where.uid, principal.groupIds]);
  if (!rows[0]) throw NOT_FOUND();
}
