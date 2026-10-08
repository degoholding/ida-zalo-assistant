/**
 * Phân quyền hai trục của backend:
 *  1. HÀNH ĐỘNG thuộc VAI TRÒ — ma trận (entity × action), chính là map dưới đây.
 *  2. PHẠM VI DỮ LIỆU thuộc NGƯỜI DÙNG — lọc ở tầng query của backend, frontend
 *     không nhìn thấy và cũng không cần biết.
 *
 * ⚠️ Map này CHỈ để ẩn/hiện menu và nút bấm cho đỡ vướng mắt. Chốt chặn thật nằm ở
 * backend (`require()` + `apply_scope()`) — tuyệt đối không coi `can()` là bảo mật.
 */

export const ACTIONS = [
  'read',
  'create',
  'write',
  'delete',
  'approve',
  'cancel',
  'print',
  'export',
  /** Cờ tổng hợp do backend thêm cho nhân sự thu mua, không phải ô trong ma trận vai trò. */
  'process',
] as const

export type PermissionAction = (typeof ACTIONS)[number]

/**
 * Thực thể của Bot trợ lý — phải khớp `ENTITIES` ở máy chủ (`src/auth/principal.ts`), CÙNG THỨ TỰ.
 * Mỗi màn quản trị một thực thể; nút / menu ẩn hiện theo ma trận này, chốt thật ở máy chủ.
 */
export const ENTITIES = [
  'bot_account',
  'conversation',
  'contact',
  'group',
  'file',
  'company',
  // Hai khóa dùng chung của khung ERP (dòng thời gian lịch sử thay đổi + cấu hình hệ thống).
  // Chỉ quản trị có; `setting.write` còn là quyền mặc định của mọi đường API máy chủ không khai riêng
  // (`src/web/api/route-permissions.ts`) — Hỏi trợ lý, Nhập lịch sử, Cài đặt đều gác bằng nó.
  'audit',
  'setting',
  // Phase 4 — màn Người dùng và Người nhận, chỉ quản trị.
  'user',
  'recipient',
] as const

export type PermissionEntity = (typeof ENTITIES)[number]

/**
 * `{ entity: { action: true } }`. Backend đôi khi trả chuỗi thay vì boolean ở một số ô
 * nên nới kiểu ra `boolean | string` và luôn ép về boolean khi đọc.
 */
export type PermissionMap = Record<string, Record<string, boolean | string>>
