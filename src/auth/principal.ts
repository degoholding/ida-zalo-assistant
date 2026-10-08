import { AsyncLocalStorage } from "node:async_hooks";
import type { RowDataPacket } from "mysql2";
import { UserRole } from "../constants.js";
import type { Db } from "../db/pool.js";

// Ai đang thao tác trên web (phase 4): quản trị bằng mật khẩu, hoặc một người dùng đăng nhập Google. Quyết định hai thứ:
// (1) được làm gì — ma trận quyền theo vai trò (permissionsFor); (2) thấy nhóm nào — groupIds (null = mọi nhóm).

export interface Principal {
  /** null = đăng nhập bằng mật khẩu quản trị (ADMIN_PASSWORD) */
  userId: number | null;
  tenantId: number;
  fullName: string;
  email: string;
  role: UserRole;
  /** Nhóm được xem; null = mọi nhóm (quản trị, hoặc người dùng tick «mọi nhóm»). */
  groupIds: number[] | null;
}

export const PASSWORD_ADMIN: Principal = { userId: null, tenantId: 1, fullName: "Quản trị", email: "", role: UserRole.Admin, groupIds: null };

/** Thực thể của giao diện — phải khớp `ENTITIES` ở web/src/core/authorization/permission-types.ts. */
export const ENTITIES = ["bot_account", "conversation", "contact", "group", "file", "company", "audit", "setting", "user", "recipient"] as const;
export type Entity = (typeof ENTITIES)[number];
export type Action = "read" | "write" | "create" | "export";
export type PermissionMap = Record<string, Record<Action, boolean>>;

/** Thực thể cho THÊM MỚI từ giao diện. Còn lại do Zalo sinh ra. */
const CREATABLE = new Set<string>(["company", "bot_account", "user", "recipient"]);

const NONE = { read: false, write: false, create: false, export: false };

/** Ma trận quyền theo vai trò. Quản trị: mọi thứ. Quản lý: xem + sửa nhóm / Danh bạ / tệp trong phạm vi, gửi tin dưới
 *  tên bot. Nhân viên: chỉ xem trong phạm vi. Cài đặt, tài khoản bot, người dùng, người nhận, nhật ký: chỉ quản trị. */
export function permissionsFor(role: UserRole): PermissionMap {
  return Object.fromEntries(ENTITIES.map((entity) => {
    if (role === UserRole.Admin) return [entity, { read: true, write: true, export: true, create: CREATABLE.has(entity) }];
    const adminOnly = ["bot_account", "setting", "user", "recipient", "audit"].includes(entity);
    if (adminOnly) return [entity, NONE];
    const canWrite = role === UserRole.Manager && ["conversation", "contact", "group", "file"].includes(entity);
    return [entity, { read: true, write: canWrite, export: role === UserRole.Manager, create: false }];
  })) as PermissionMap;
}

export function can(principal: Principal, entity: Entity, action: Action): boolean {
  return permissionsFor(principal.role)[entity]?.[action] === true;
}

/** Người dùng (đang bật) → danh tính thao tác. null = không có / đã tắt. */
export async function loadUserPrincipal(db: Db, userId: number): Promise<Principal | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, tenant_id, email, full_name, role, all_groups, is_active FROM app_user WHERE id = ?", [userId]);
  const user = rows[0];
  if (!user || !user.is_active) return null;
  const role = Number(user.role) as UserRole;
  let groupIds: number[] | null = null;
  if (role !== UserRole.Admin && !user.all_groups) {
    const [scope] = await db.query<RowDataPacket[]>("SELECT group_id FROM user_group_scope WHERE user_id = ?", [userId]);
    groupIds = scope.map((row) => Number(row.group_id));
  }
  return {
    userId: Number(user.id), tenantId: Number(user.tenant_id), fullName: String(user.full_name || user.email), email: String(user.email),
    role, groupIds,
  };
}

/**
 * Điều kiện SQL «cuộc / nhóm này nằm trong phạm vi». `column` = cột id của zalo_group trong câu truy vấn. Người bị khoanh
 * phạm vi thì không thấy cuộc nhắn riêng với bot (hộp thư của bot) — chỉ quản trị / người thấy mọi nhóm mới thấy.
 */
export function groupScopeSql(principal: Principal, column: string): { sql: string; params: unknown[] } | null {
  if (principal.groupIds === null) return null;
  if (!principal.groupIds.length) return { sql: "1 = 0", params: [] };
  return { sql: `${column} IN (?)`, params: [principal.groupIds] };
}

export function canSeeGroup(principal: Principal, groupId: number): boolean {
  return principal.groupIds === null || principal.groupIds.includes(groupId);
}

/** Người đang thao tác trong lượt xử lý API hiện tại — để nhật ký ghi đúng tên mà không phải truyền qua mọi hàm. */
export const currentPrincipal = new AsyncLocalStorage<Principal>();

/** Tên ghi vào cột actor của nhật ký: người đang thao tác, ngoài lượt API (việc nền, dòng lệnh) là «Hệ thống». */
export function currentActorName(): string {
  return currentPrincipal.getStore()?.fullName ?? "Hệ thống";
}
