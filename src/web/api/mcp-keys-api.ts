import type { RowDataPacket } from "mysql2";
import { McpAccessLevel, UserRole } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { canSeeConfidential, type Principal } from "../../auth/principal.js";
import { createMcpKey, maxAccessLevelForRole, McpKeyValidationError, revokeMcpKey } from "../../auth/mcp-api-key-store.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { recordAudit } from "./audit-log.js";
import type { ListSpec, SqlPart } from "./list-query.js";
import { runList } from "./list-runner.js";

// Màn "Khóa MCP" (17/10/2026): mỗi người tự tạo / xem / thu hồi khóa CỦA MÌNH; quản trị xem + thu hồi mọi khóa (`scope=all`).
// Khóa thô chỉ có trong phản hồi TẠO; không phản hồi nào chứa token_hash. Khóa MCP không tự quản được khóa (không có công cụ).

/** Hạn khóa cho phép chọn trên giao diện (ngày); null = không hết hạn. */
export const KEY_EXPIRY_DAY_OPTIONS = [30, 90, 365] as const;
const RECENT_CALLS_LIMIT = 50;
const STATUS_SQL = `CASE WHEN k.revoked_at IS NOT NULL THEN 'revoked'
  WHEN k.expires_at IS NOT NULL AND k.expires_at <= NOW(3) THEN 'expired' ELSE 'active' END`;

const STATUS_CONDITIONS: Record<string, string> = {
  active: "k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > NOW(3))",
  expired: "k.revoked_at IS NULL AND k.expires_at IS NOT NULL AND k.expires_at <= NOW(3)",
  revoked: "k.revoked_at IS NOT NULL",
};

export const MCP_KEY_LIST_SPEC: ListSpec = {
  fields: {
    name: { sql: "k.name", type: "text" },
    access_level: { sql: "k.access_level", type: "number" },
    // Trạng thái suy ra từ revoked_at / expires_at — chỉ nhận active / expired / revoked, giá trị lạ bị bỏ qua
    status: { type: "text", build: (_operator, values) => (STATUS_CONDITIONS[values[0]] ? { sql: STATUS_CONDITIONS[values[0]], params: [] } : null) },
    // Chỉ có tác dụng với quản trị: người khác đã bị khóa cứng `user_id = mình` ở baseWhere
    user_id: { sql: "k.user_id", type: "number" },
  },
  sorts: { created_at: "k.created_at", last_used_at: "k.last_used_at IS NULL, k.last_used_at", name: "k.name" },
  defaultSort: { by: "created_at", dir: "desc" },
  tieBreaker: "k.id",
  search: { param: "q", columns: ["k.name", "k.prefix"] },
};

const KEY_FROM = "FROM mcp_api_key k JOIN app_user u ON u.id = k.user_id";
const KEY_COLUMNS = `k.id, k.user_id, k.name, k.prefix, k.access_level, k.include_confidential, k.expires_at, k.last_used_at, k.last_used_ip,
  k.revoked_at, k.created_at, COALESCE(NULLIF(u.full_name, ''), u.username, u.email) AS owner_name, ${STATUS_SQL} AS status`;

function decorate(rows: RowDataPacket[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    ...row, access_level: Number(row.access_level), include_confidential: Boolean(row.include_confidential), owner_name: row.owner_name ?? "",
  }));
}

const isAdmin = (principal: Principal): boolean => principal.role === UserRole.Admin;

function requireUserId(principal: Principal): number {
  if (principal.userId === null) throw new ApiError(403, "forbidden", "Chỉ người dùng đăng nhập mới quản lý được khóa MCP");
  return principal.userId;
}

/** Phạm vi dòng: quản trị thấy mọi khóa của công ty (hoặc chỉ của mình khi không bật `scope=all`); người khác chỉ khóa của mình. */
export function keyScopeWhere(principal: Principal, wantAll: boolean): SqlPart {
  if (isAdmin(principal) && wantAll) return { sql: "k.tenant_id = ?", params: [principal.tenantId] };
  return { sql: "k.tenant_id = ? AND k.user_id = ?", params: [principal.tenantId, principal.userId ?? 0] };
}

async function loadKey(db: Db, principal: Principal, id: number): Promise<Record<string, unknown>> {
  const scope = keyScopeWhere(principal, true);
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${KEY_COLUMNS} ${KEY_FROM} WHERE k.id = ? AND ${scope.sql}`, [id, ...scope.params]);
  // Khóa người khác → 404 (không lộ là có tồn tại)
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có khóa này");
  return decorate(rows)[0];
}

async function loadRecentCalls(db: Db, keyId: number): Promise<unknown[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, created_at, tool, entity, status, row_count, duration_ms, error_code FROM mcp_call_log
     WHERE key_id = ? ORDER BY id DESC LIMIT ${RECENT_CALLS_LIMIT}`, [keyId]);
  return rows.map((row) => ({ ...row, status: Number(row.status), row_count: Number(row.row_count), duration_ms: Number(row.duration_ms) }));
}

export interface CreateKeyInput {
  name: string;
  accessLevel: McpAccessLevel;
  includeConfidential: boolean;
  days: number | null;
}

function invalid(message: string): ApiError {
  return new ApiError(422, "validation_error", message);
}

/** Thân POST → dữ liệu đã kiểm; không cho vượt mức của vai trò, không cho Mật khi người tạo chưa có cờ Mật. */
export function parseCreateKeyInput(body: Record<string, unknown>, principal: Principal): CreateKeyInput {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) throw invalid("Tên khóa phải từ 1 đến 100 ký tự");
  const accessLevel = Number(body.access_level);
  if (accessLevel !== McpAccessLevel.Read && accessLevel !== McpAccessLevel.ReadWrite) throw invalid("Mức quyền khóa không hợp lệ");
  if (accessLevel > maxAccessLevelForRole(principal.role)) throw new ApiError(403, "forbidden", "Vai trò của anh/chị chỉ được tạo khóa chỉ đọc");
  if (body.include_confidential !== undefined && typeof body.include_confidential !== "boolean") throw invalid("'Cho đọc nhóm Mật' chỉ nhận bật / tắt");
  const includeConfidential = body.include_confidential === true;
  if (includeConfidential && !canSeeConfidential(principal)) throw invalid("Tài khoản chưa được cấp quyền xem nhóm Mật nên không tạo được khóa đọc nhóm Mật");
  const rawDays = body.expires_in_days ?? null;
  const days = rawDays === null ? null : Number(rawDays);
  if (days !== null && !(KEY_EXPIRY_DAY_OPTIONS as readonly number[]).includes(days)) throw invalid("Hạn khóa chỉ nhận 30, 90, 365 ngày hoặc không hết hạn");
  return { name, accessLevel, includeConfidential, days };
}

export const mcpKeyRoutes: ApiRoute[] = [
  ["GET", /^\/api\/mcp-keys$/, async ({ response, url, service, principal }) => {
    const wantAll = url.searchParams.get("scope") === "all";
    sendOk(response, await runList(service.db, url.searchParams, MCP_KEY_LIST_SPEC, {
      select: KEY_COLUMNS, from: KEY_FROM, baseWhere: keyScopeWhere(principal, wantAll), decorate,
    }));
  }],
  // Giới hạn của người này cho hộp thoại tạo — web không biết cờ Mật, nên hỏi ở đây thay vì đoán
  ["GET", /^\/api\/mcp-keys\/options$/, async ({ response, principal }) => sendOk(response, {
    max_access_level: maxAccessLevelForRole(principal.role), can_include_confidential: canSeeConfidential(principal),
    expiry_days: KEY_EXPIRY_DAY_OPTIONS, is_admin: isAdmin(principal),
  })],
  ["GET", /^\/api\/mcp-keys\/(\d+)$/, async ({ response, match, service, principal }) => {
    const id = parseId(match[1]);
    sendOk(response, { ...(await loadKey(service.db, principal, id)), recent_calls: await loadRecentCalls(service.db, id) });
  }],
  ["POST", /^\/api\/mcp-keys$/, async ({ request, response, service, principal }) => {
    const userId = requireUserId(principal);
    const input = parseCreateKeyInput(await readJson(request), principal);
    let created: { id: number; token: string; prefix: string };
    try {
      created = await createMcpKey(service.db, { userId, name: input.name, accessLevel: input.accessLevel, days: input.days, includeConfidential: input.includeConfidential });
    } catch (error) {
      // Chỉ lỗi nghiệp vụ do kho khóa chủ động ném (McpKeyValidationError) mới thành 422; mọi lỗi khác (DB, bug) đi tiếp thành 500 chung
      if (error instanceof McpKeyValidationError) throw invalid(error.message);
      throw error;
    }
    await recordAudit(service.db, { entity: "mcp_key", entityId: created.id, action: "create", message: `Tạo khóa MCP "${input.name}" (${created.prefix})` });
    // Khóa thô chỉ nằm ở đây — không log, không lưu
    sendOk(response, { key: await loadKey(service.db, principal, created.id), token: created.token }, "Đã tạo khóa — chép ngay, sẽ không hiện lại", 201);
  }],
  ["POST", /^\/api\/mcp-keys\/(\d+)\/revoke$/, async ({ response, match, service, principal }) => {
    const userId = requireUserId(principal);
    const id = parseId(match[1]);
    const before = await loadKey(service.db, principal, id);
    // Đã thu hồi → trả nguyên, không ghi nhật ký lần hai
    if (before.revoked_at) { sendOk(response, before, "Khóa đã được thu hồi trước đó"); return; }
    const revoked = await revokeMcpKey(service.db, id, principal.fullName, isAdmin(principal) ? undefined : userId);
    if (revoked) await recordAudit(service.db, { entity: "mcp_key", entityId: id, action: "revoke", message: `Thu hồi khóa MCP "${before.name}" (${before.prefix})` });
    sendOk(response, await loadKey(service.db, principal, id), "Đã thu hồi khóa");
  }],
];
