// Thực thể của Bot trợ lý — phải khớp `ENTITIES` ở `web/src/core/authorization/permission-types.ts`.
// Bản đầu chỉ có MỘT quản trị (ADMIN_PASSWORD) nên ma trận cấp đủ; khi thêm tài khoản theo vai trò
// (trưởng phòng…) thì tính ma trận theo người ở đây, giao diện không phải đổi.

export const ENTITIES = ["bot_account", "conversation", "contact", "group", "file", "company", "audit"] as const;

/** Thực thể cho THÊM MỚI từ giao diện (công ty gõ tay, tài khoản bot qua QR). Còn lại do Zalo sinh ra. */
const CREATABLE = new Set<string>(["company", "bot_account"]);

export type PermissionMap = Record<string, Record<string, boolean>>;

export function buildAdminPermissions(): PermissionMap {
  return Object.fromEntries(ENTITIES.map((entity) => [entity, { read: true, write: true, export: true, create: CREATABLE.has(entity) }]));
}
