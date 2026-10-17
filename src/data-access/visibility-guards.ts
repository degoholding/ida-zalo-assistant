import type { RowDataPacket } from "mysql2";
import { groupScopeSql } from "../auth/principal.js";
import { ConversationType } from "../constants.js";
import type { SqlPart } from "../web/api/list-query.js";
import type { DataAccessContext } from "./data-access-context.js";
import { DataAccessError, translateDbError } from "./data-access-errors.js";
import { QUERY_TIME_HINT } from "./query-compiler.js";

// Chốt chặn «được thấy cuộc / tin / tệp này không» — MỘT chỗ cho lõi truy cập dữ liệu (phase 6 dùng lại cho trợ lý, vá H1).
// Ba lớp: (1) cuộc phải ĐỌC được (cuộc riêng, hoặc nhóm bật «Đọc tin»); (2) nằm trong phạm vi nhóm của principal;
// (3) không phải nhóm Mật khi `ctx.includeConfidential` tắt. Ngoài phạm vi = `not_found` (không lộ «có mà không được xem»).

/** Phạm vi nhóm + Mật cho cột id nhóm `column` và cờ Mật `confidentialColumn` (đều của zalo_group). */
export function groupVisibilitySql(ctx: DataAccessContext, column: string, confidentialColumn: string): SqlPart {
  const parts: string[] = [];
  const params: unknown[] = [];
  const scope = groupScopeSql(ctx.principal, column);
  if (scope) {
    parts.push(scope.sql);
    params.push(...scope.params);
  }
  if (!ctx.includeConfidential) parts.push(`${confidentialColumn} = 0`);
  return { sql: parts.length ? parts.join(" AND ") : "1 = 1", params };
}

/**
 * Điều kiện «cuộc riêng này thấy được» cho bảng zalo_group bí danh `alias`. Mặc định mọi cuộc riêng (luật web); khi
 * `ctx.ownDirectThreadsOnly` bật thì chỉ cuộc riêng của chính người hỏi (`zalo_group_id = ownDirectUid`).
 */
export function directThreadSql(ctx: DataAccessContext, alias: string): SqlPart {
  const direct = `${alias}.thread_type = ${ConversationType.Direct}`;
  if (!ctx.ownDirectThreadsOnly) return { sql: direct, params: [] };
  if (!ctx.ownDirectUid) return { sql: "1 = 0", params: [] };
  return { sql: `(${direct} AND ${alias}.zalo_group_id = ?)`, params: [ctx.ownDirectUid] };
}

/** Cuộc đọc được = cuộc riêng (xem `directThreadSql`), hoặc nhóm đã bật «Đọc tin». `alias` = bí danh bảng zalo_group. */
export function threadVisibilitySql(ctx: DataAccessContext, alias: string): SqlPart {
  const visible = groupVisibilitySql(ctx, `${alias}.id`, `${alias}.is_confidential`);
  const direct = directThreadSql(ctx, alias);
  // Chế độ «chỉ cuộc riêng của mình»: cuộc riêng KHÔNG được lọt qua cờ read_messages (nó chỉ dành cho nhóm)
  const group = ctx.ownDirectThreadsOnly
    ? `(${alias}.thread_type <> ${ConversationType.Direct} AND ${alias}.read_messages = 1)`
    : `${alias}.read_messages = 1`;
  return { sql: `(${direct.sql} OR ${group}) AND ${visible.sql}`, params: [...direct.params, ...visible.params] };
}

const NOT_FOUND = (what: string) => new DataAccessError("not_found", `Không tìm thấy ${what}.`);

async function assertExists(ctx: DataAccessContext, sql: string, params: unknown[], what: string): Promise<void> {
  let found: boolean;
  try {
    const [rows] = await ctx.db.query<RowDataPacket[]>(`${sql.replace(/^SELECT /, `SELECT ${QUERY_TIME_HINT} `)} LIMIT 1`, params);
    found = Boolean(rows[0]);
  } catch (error) {
    return translateDbError(error);
  }
  if (!found) throw NOT_FOUND(what);
}

/** Cuộc / nhóm phải đọc được (xem trên), không thì `not_found`. */
export async function assertThreadReadable(ctx: DataAccessContext, threadId: number): Promise<void> {
  const visible = threadVisibilitySql(ctx, "g");
  await assertExists(ctx, `SELECT 1 FROM zalo_group g WHERE g.id = ? AND ${visible.sql}`, [threadId, ...visible.params], "cuộc trò chuyện này");
}

/** Tệp phải thuộc một cuộc đọc được, và tin chứa tệp chưa bị thu hồi (cùng luật với `messages`). */
export async function assertAttachmentReadable(ctx: DataAccessContext, attachmentId: number): Promise<void> {
  const visible = threadVisibilitySql(ctx, "g");
  await assertExists(ctx, `SELECT 1 FROM attachment a JOIN zalo_group g ON g.id = a.group_id JOIN message m ON m.id = a.message_id
    WHERE a.id = ? AND m.recalled_at IS NULL AND ${visible.sql}`,
    [attachmentId, ...visible.params], "tệp này");
}

/** Tin phải thuộc một cuộc đọc được và chưa bị thu hồi. */
export async function assertMessageReadable(ctx: DataAccessContext, messageId: number): Promise<void> {
  const visible = threadVisibilitySql(ctx, "g");
  await assertExists(ctx, `SELECT 1 FROM message m JOIN zalo_group g ON g.id = m.group_id WHERE m.id = ? AND m.recalled_at IS NULL AND ${visible.sql}`,
    [messageId, ...visible.params], "tin nhắn này");
}

/**
 * Việc / ticket gắn «nhóm nguồn» (cột `threadColumn`, nối bảng zalo_group bí danh `groupAlias` bằng LEFT JOIN): người bị khoanh
 * phạm vi chỉ thấy bản ghi của nhóm được gán (không nhóm nguồn = không thấy); không Mật thì bỏ bản ghi của nhóm Mật.
 */
export function sourceThreadVisibilitySql(ctx: DataAccessContext, threadColumn: string, groupAlias: string): SqlPart | undefined {
  const parts: string[] = [];
  const params: unknown[] = [];
  const scope = groupScopeSql(ctx.principal, threadColumn);
  if (scope) {
    parts.push(scope.sql);
    params.push(...scope.params);
  }
  if (!ctx.includeConfidential) parts.push(`(${groupAlias}.id IS NULL OR ${groupAlias}.is_confidential = 0)`);
  return parts.length ? { sql: parts.join(" AND "), params } : undefined;
}

/** Nối hai điều kiện cố định (bỏ phần trống). */
export function andParts(...parts: (SqlPart | undefined)[]): SqlPart | undefined {
  const present = parts.filter((part): part is SqlPart => Boolean(part));
  if (!present.length) return undefined;
  return { sql: present.map((part) => `(${part.sql})`).join(" AND "), params: present.flatMap((part) => part.params) };
}
