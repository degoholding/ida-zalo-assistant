import type { RowDataPacket } from "mysql2";
import type { Db } from "../../db/pool.js";
import { ApiError } from "./api-http.js";
import { ADMIN_USER, type ApiRoute } from "./api-route.js";
import { sendOk } from "./api-http.js";

// Nhật ký thay đổi — nguồn của mục «Lịch sử» (AuditTimeline) ở mọi trang chi tiết của `web/`.
// Response giữ đúng hình `AuditLogEntry` của ERP v2 để khung giao diện chép sang chạy nguyên.

export type AuditEntity = "contact" | "group" | "company" | "bot_account" | "file" | "setting";

const ACTION_LABEL: Record<string, string> = {
  create: "Tạo mới",
  update: "Cập nhật",
  backfill: "Lấy tin cũ",
  import: "Nhập lịch sử",
  retry: "Tải lại tệp",
  extract: "Đọc chữ trong tệp",
  activate: "Bật",
  deactivate: "Tắt",
  qr_login: "Đăng nhập QR",
  reset: "Khôi phục mặc định",
  test_connection: "Kiểm tra kết nối",
  google_connect: "Kết nối Google",
  google_disconnect: "Ngắt kết nối Google",
  delete: "Gỡ",
  reorder: "Đổi thứ tự",
};

const AUDIT_ENTITIES = new Set<string>(["contact", "group", "company", "bot_account", "file", "setting"]);
const MAX_LIMIT = 200;

/**
 * Nhãn các ô đã đổi giữa hai bản. So bằng chuỗi (1 và "1" là một) — dữ liệu từ MySQL và từ JSON
 * khác kiểu nhưng cùng nghĩa. Mảng (thẻ) so theo nội dung đã sắp.
 */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>): string[] {
  const normalize = (value: unknown): string =>
    Array.isArray(value) ? [...value].map(String).sort().join("\u0001") : value === null || value === undefined ? "" : String(value);
  return Object.keys(labels).filter((key) => key in after && normalize(before[key]) !== normalize(after[key])).map((key) => labels[key]);
}

export async function recordAudit(
  db: Db,
  entry: { entity: AuditEntity; entityId: number; action: string; message?: string; changedFields?: string[] },
): Promise<void> {
  const fields = entry.changedFields ?? [];
  await db.query(
    "INSERT INTO audit_log (entity, entity_id, action, message, changed_fields, change_count, actor) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [entry.entity, entry.entityId, entry.action, (entry.message ?? "").slice(0, 500), fields.join(", ").slice(0, 500), fields.length, ADMIN_USER.full_name],
  );
}

export const auditRoutes: ApiRoute[] = [
  ["GET", /^\/api\/audit-logs$/, async ({ response, url, service }) => {
    const entity = url.searchParams.get("entity") ?? "";
    const entityId = Number(url.searchParams.get("entity_id"));
    if (!AUDIT_ENTITIES.has(entity) || !Number.isSafeInteger(entityId) || entityId <= 0) {
      throw new ApiError(422, "validation_error", "Thiếu hoặc sai entity / entity_id");
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    const [rows] = await service.db.query<RowDataPacket[]>(
      `SELECT id, action, message, entity_id, actor, created_at, changed_fields, change_count
       FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT ?`, [entity, entityId, limit]);
    sendOk(response, rows.map((row) => ({
      id: row.id,
      action: row.action,
      action_label: ACTION_LABEL[row.action as string] ?? String(row.action),
      message: row.message || (row.changed_fields ? `Đổi ${row.changed_fields}` : ""),
      entity_id: row.entity_id,
      by: row.actor,
      at: row.created_at,
      changed_fields: row.changed_fields,
      change_count: row.change_count,
    })));
  }],
];
