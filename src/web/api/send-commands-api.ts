import type { RowDataPacket } from "mysql2";
import type { Principal } from "../../auth/principal.js";
import { UserRole } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { cancelSendCommand } from "../../send-commands/send-command-actions.js";
import { resendFailedTargets } from "../../send-commands/send-command-web-actions.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import type { ApiContext, ApiRoute } from "./api-route.js";
import { recordAudit } from "./audit-log.js";
import type { ListSpec, Operator, SqlPart } from "./list-query.js";
import { runList } from "./list-runner.js";
import { parseVnDayStart } from "./message-search-api.js";

// Màn web "Gửi tin" (phase 9, phase 5): nhật ký lệnh gửi (Zalo + tin quản trị gửi từ web), hủy lệnh hẹn, gửi lại nơi lỗi,
// Tắt / Bật bot khẩn. Phạm vi dòng khuôn `briefs-api.ts`: quản trị thấy hết; vai trò khác chỉ thấy lệnh do CHÍNH mình ra
// (tài khoản web gắn liên hệ `app_user.contact_id` → `contact.zalo_uid` = `requester_uid`); chưa gắn liên hệ → rỗng; lệnh
// người khác (kể cả nhóm Mật) → 404. Gửi lại nơi lỗi + Tắt / Bật chỉ quản trị.

const DAY_MS = 86_400_000;
const BODY_PREVIEW_CHARS = 80;
const GENERIC_ERROR = "Gửi không được — nhờ quản trị xem nhật ký hệ thống.";

/** "Trong khoảng" (hoặc đúng ngày / ≤ / ≥…) trên một cột ngày theo giờ Việt Nam — cùng khuôn `buildBriefCreatedAtCondition`. */
export function buildVnDayCondition(column: string, operator: Operator, values: string[]): SqlPart | null {
  const [first, second] = values.map(parseVnDayStart);
  if (!first) return null;
  const next = (day: Date) => new Date(day.getTime() + DAY_MS);
  switch (operator) {
    case "eq": return { sql: `(${column} >= ? AND ${column} < ?)`, params: [first, next(first)] };
    case "ne": return { sql: `(${column} < ? OR ${column} >= ?)`, params: [first, next(first)] };
    case "gte": return { sql: `${column} >= ?`, params: [first] };
    case "gt": return { sql: `${column} >= ?`, params: [next(first)] };
    case "lte": return { sql: `${column} < ?`, params: [next(first)] };
    case "lt": return { sql: `${column} < ?`, params: [first] };
    case "between": return second ? { sql: `(${column} >= ? AND ${column} < ?)`, params: [first, next(second)] } : null;
    default: return null;
  }
}

export const SEND_COMMAND_LIST_SPEC: ListSpec = {
  fields: {
    status: { sql: "c.status", type: "number" },
    source: { sql: "c.source", type: "number" },
    action_kind: { sql: "c.action_kind", type: "number" },
    requester_uid: { sql: "c.requester_uid", type: "text" },
    created_at: { type: "date", build: (operator, values) => buildVnDayCondition("c.created_at", operator, values) },
    scheduled_at: { type: "date", build: (operator, values) => buildVnDayCondition("c.scheduled_at", operator, values) },
    reminder_at: { type: "date", build: (operator, values) => buildVnDayCondition("c.reminder_at", operator, values) },
  },
  sorts: {
    created_at: "c.created_at", scheduled_at: "c.scheduled_at IS NULL, c.scheduled_at", action_kind: "c.action_kind",
    reminder_at: "c.reminder_at IS NULL, c.reminder_at",
  },
  defaultSort: { by: "created_at", dir: "desc" },
  tieBreaker: "c.id",
  search: { param: "q", columns: ["c.requester_name", "c.body"] },
};

const COMMAND_FROM = "FROM send_command c";
const COMMAND_COLUMNS = `c.id, c.source, c.status, c.action_kind, c.reminder_at, c.reminder_repeat, c.requester_uid, c.requester_name, c.scheduled_at, c.off_hours_note, c.cancelled_by,
  c.created_at, c.reported_at, LEFT(c.body, ${BODY_PREVIEW_CHARS}) AS body_preview, CHAR_LENGTH(c.body) > ${BODY_PREVIEW_CHARS} AS body_truncated,
  (SELECT COUNT(*) FROM send_command_target t WHERE t.command_id = c.id) AS target_count,
  (SELECT COUNT(*) FROM send_command_target t WHERE t.command_id = c.id AND t.status = 3) AS sent_count,
  (SELECT COUNT(*) FROM send_command_target t WHERE t.command_id = c.id AND t.status = 4) AS failed_count`;

const isAdmin = (principal: Principal): boolean => principal.role === UserRole.Admin;

/** Phạm vi dòng: quản trị thấy hết (trong tenant); vai trò khác chỉ thấy lệnh do liên hệ gắn với TÀI KHOẢN MÌNH ra. */
export function commandScopeWhere(principal: Principal): SqlPart {
  const tenant: SqlPart = { sql: "c.tenant_id = ?", params: [principal.tenantId] };
  if (isAdmin(principal)) return tenant;
  return {
    sql: `${tenant.sql} AND c.requester_uid <> '' AND c.requester_uid = (SELECT ct.zalo_uid FROM app_user u JOIN contact ct ON ct.id = u.contact_id WHERE u.id = ?)`,
    params: [...tenant.params, principal.userId ?? 0],
  };
}

function decorateRows(rows: RowDataPacket[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    ...row, id: Number(row.id), source: Number(row.source), status: Number(row.status), action_kind: Number(row.action_kind),
    reminder_repeat: Number(row.reminder_repeat), target_count: Number(row.target_count),
    sent_count: Number(row.sent_count), failed_count: Number(row.failed_count), body_truncated: Boolean(Number(row.body_truncated)),
  }));
}

async function getCommandDetail(db: Db, id: number, principal: Principal): Promise<Record<string, unknown>> {
  const where = commandScopeWhere(principal);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${COMMAND_COLUMNS}, c.body, c.attachment_ids ${COMMAND_FROM} WHERE c.id = ? AND (${where.sql})`, [id, ...where.params]);
  const row = rows[0];
  // Ngoài phạm vi cũng 404 — không để lộ "có lệnh này nhưng không được xem"
  if (!row) throw new ApiError(404, "not_found", "Không có lệnh gửi này");
  const [targets] = await db.query<RowDataPacket[]>(
    `SELECT id, target_kind, thread_id, display_name, status, attempt_no, error, sent_at FROM send_command_target WHERE command_id = ? ORDER BY id`, [id]);
  const attachmentIds = parseIdList(row.attachment_ids);
  let files: { id: number; file_name: string }[] = [];
  if (attachmentIds.length) {
    // Chỉ tên tệp — không bao giờ trả khóa lưu trữ
    const [fileRows] = await db.query<RowDataPacket[]>("SELECT id, file_name FROM attachment WHERE id IN (?)", [attachmentIds]);
    files = fileRows.map((file) => ({ id: Number(file.id), file_name: String(file.file_name) }));
  }
  const admin = isAdmin(principal);
  const { attachment_ids: _attachmentIds, ...rest } = decorateRows([row])[0];
  return {
    ...rest, body: String(row.body ?? ""), files,
    targets: targets.map((target) => ({
      id: Number(target.id), kind: Number(target.target_kind), thread_id: target.thread_id === null ? null : Number(target.thread_id),
      display_name: String(target.display_name), status: Number(target.status), attempt_no: Number(target.attempt_no),
      error: target.error && !admin ? GENERIC_ERROR : String(target.error ?? ""), sent_at: target.sent_at,
    })),
  };
}

function parseIdList(raw: unknown): number[] {
  if (!raw) return [];
  const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(value) ? value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : [];
}

async function runCommandAction(ctx: ApiContext): Promise<void> {
  const { request, response, match, service, principal } = ctx;
  const id = parseId(match[1]);
  const body = await readJson(request);
  const action = body.action;
  if (action !== "cancel" && action !== "resend_failed") throw new ApiError(422, "validation_error", "action phải là cancel hoặc resend_failed");
  // Ngoài phạm vi → 404 trước mọi thứ khác (kể cả 403) để không dò được lệnh người khác
  await getCommandDetail(service.db, id, principal);
  if (action === "resend_failed" && !isAdmin(principal)) throw new ApiError(403, "forbidden", "Chỉ quản trị được gửi lại nơi lỗi.");
  // Lịch đọc lười (getter) — hủy / gửi lại không cần lịch, lịch cài sai không được chặn nút Hủy
  const deps = service.sendCommandDeps();
  const actor = { via: "web", name: principal.fullName } as const;
  const result = action === "cancel" ? await cancelSendCommand(deps, actor, id) : await resendFailedTargets(deps, actor, id);
  // Dịch vụ từ chối (lệnh đã gửi / đã hủy / không có nơi lỗi…) → 409 kèm lý do, KHÔNG ghi nhật ký thao tác
  if (!result.ok) throw new ApiError(409, "action_not_applicable", result.reply);
  await recordAudit(service.db, { entity: "send_command", entityId: id, action: action === "cancel" ? "cancel" : "resend", message: result.reply });
  sendOk(response, await getCommandDetail(service.db, id, principal), result.reply);
}

export const sendCommandRoutes: ApiRoute[] = [
  ["GET", /^\/api\/send-commands$/, async ({ response, url, service, principal }) => sendOk(response, await runList(service.db, url.searchParams, SEND_COMMAND_LIST_SPEC, {
    select: COMMAND_COLUMNS, from: COMMAND_FROM, baseWhere: commandScopeWhere(principal), decorate: decorateRows,
  }))],

  ["GET", /^\/api\/send-commands\/(\d+)$/, async ({ response, match, service, principal }) =>
    sendOk(response, await getCommandDetail(service.db, parseId(match[1]), principal))],

  ["POST", /^\/api\/send-commands\/(\d+)\/actions$/, runCommandAction],

  // Dải đỏ "bot đang tắt" đọc cho mọi người đăng nhập (quyền conversation:read); bật / tắt không khai → chỉ quản trị
  ["GET", /^\/api\/bot-halt$/, async ({ response, service }) => sendOk(response, service.botHalt.status())],

  ["POST", /^\/api\/bot-halt$/, async ({ request, response, service, principal }) => {
    const body = await readJson(request);
    if (typeof body.halted !== "boolean") throw new ApiError(422, "validation_error", "halted phải là true hoặc false");
    // Idempotent: đang ở đúng trạng thái thì trả tình trạng hiện tại; `halt` / `resume` tự ghi nhật ký thao tác
    const state = body.halted ? await service.botHalt.halt(principal.fullName, "web") : await service.botHalt.resume(principal.fullName, "web");
    sendOk(response, state, body.halted ? "Đã tắt bot khẩn" : "Đã bật lại bot");
  }],
];
