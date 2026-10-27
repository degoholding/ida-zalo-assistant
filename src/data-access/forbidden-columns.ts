import { listFilterFields } from "./filter-fields.js";
import type { DataAccessContext } from "./data-access-context.js";
import type { EntityDefinition } from "./entity-definition.js";

// Chốt chặn bí mật: không định nghĩa thực thể nào được nhắc tới cột / bảng chứa bí mật hoặc nội bộ. `findForbiddenReferences`
// duyệt mọi chuỗi SQL của một thực thể (FROM, cột, spec lọc / sắp xếp / tìm, điều kiện cố định); test duyệt cả registry.

export const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /password_hash/i, /token_hash/i, /session_cipher/i, /\bsecret\b/i, /refresh_token/i, /access_token/i,
  // `bot_account(?!_id)`: cấm BẢNG bot_account (phiên Zalo mã hóa, imei…) nhưng cho cột khóa ngoại `bot_group.bot_account_id` — lọc
  // theo tài khoản Zalo (27/10/2026) chỉ cần id, không đọc gì của bảng tài khoản
  /app_setting/i, /web_session/i, /ai_key/i, /mcp_api_key/i, /mcp_call_log/i, /mcp_write_draft/i, /bot_account(?!_id)/i, /google_/i,
  // Nội bộ lưu tệp: khóa lưu trữ + đường dẫn nguồn của Zalo
  /storage_key/i, /source_url/i,
];

/**
 * Ngoại lệ duy nhất: điều kiện phạm vi của `audit_log` hỏi «khóa MCP này của tôi không» (`SELECT 1 FROM mcp_api_key … user_id = ?`) —
 * KHÔNG đọc `token_hash` / tiền tố khóa, chỉ để người không phải quản trị thấy dòng nhật ký của khóa chính mình.
 */
const BASE_WHERE_EXCEPTIONS: Record<string, RegExp[]> = { audit_log: [/mcp_api_key/i] };

/** Mẫu cấm khớp trong `sql` (kèm nhãn nơi gặp). */
function scan(label: string, sql: string | undefined, hits: string[], allowed: RegExp[] = []): void {
  if (!sql) return;
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (allowed.some((exception) => exception.source === pattern.source)) continue;
    if (pattern.test(sql)) hits.push(`${label}: ${pattern} trong «${sql.slice(0, 80)}»`);
  }
}

/** Mọi chỗ trong thực thể `def` (theo người gọi `ctx`) nhắc tới thứ cấm. Rỗng = sạch. */
export function findForbiddenReferences(def: EntityDefinition, ctx: DataAccessContext): string[] {
  const hits: string[] = [];
  scan(`${def.name}.from`, def.from, hits);
  for (const [key, column] of Object.entries(def.columns)) scan(`${def.name}.columns.${key}`, column.sql, hits);
  const spec = def.spec(ctx);
  scan(`${def.name}.tieBreaker`, spec.tieBreaker, hits);
  for (const [key, sql] of Object.entries(spec.sorts)) scan(`${def.name}.sorts.${key}`, sql, hits);
  for (const column of spec.search?.columns ?? []) scan(`${def.name}.search`, column, hits);
  const base = def.baseWhere(ctx);
  scan(`${def.name}.baseWhere`, base?.sql, hits, BASE_WHERE_EXCEPTIONS[def.name]);
  // Hàm `build` là closure — gọi thử với giá trị mẫu để thấy SQL nó sinh
  for (const [name, info] of Object.entries(listFilterFields(def, ctx))) {
    scan(`${def.name}.fields.${name}`, info.spec.sql, hits);
    if (!info.spec.build) continue;
    for (const op of info.ops) {
      try {
        scan(`${def.name}.fields.${name}.build(${op})`, info.spec.build(op, ["1"])?.sql, hits);
      } catch { /* mẫu không hợp lệ với hàm này — bỏ qua */ }
    }
  }
  return hits;
}
