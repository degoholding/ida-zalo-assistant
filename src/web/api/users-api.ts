import type { RowDataPacket } from "mysql2";
import { ConversationType, UserRole } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { hashPassword, MAX_PASSWORD_LENGTH } from "../../auth/password.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { diffFields, recordAudit } from "./audit-log.js";
import type { ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";

// Người dùng giao diện quản trị (phase 4, chỉ quản trị sửa). Đăng nhập bằng tên đăng nhập + mật khẩu, hoặc nút Google theo
// email; vai trò quyết định được làm gì, phạm vi nhóm quyết định thấy gì. Tắt / đổi vai trò / đổi phạm vi / đổi mật khẩu →
// đá phiên đang mở của người đó ngay. Mật khẩu chỉ đi VÀO (băm scrypt) — không bao giờ trả về.

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,180}\.[a-z]{2,24}$/i;
const NAME_MAX = 150;
const USERNAME_PATTERN = /^[a-z0-9._@-]{3,100}$/;
const PASSWORD_MIN = 4;
const MAX_SCOPE_GROUPS = 500;

export const USER_LIST_SPEC: ListSpec = {
  fields: {
    email: { sql: "u.email", type: "text" },
    username: { sql: "u.username", type: "text" },
    full_name: { sql: "u.full_name", type: "text" },
    role: { sql: "u.role", type: "number" },
    is_active: { sql: "u.is_active", type: "boolean" },
    last_login_at: { sql: "u.last_login_at", type: "date" },
  },
  sorts: { full_name: "u.full_name", email: "u.email", username: "u.username", role: "u.role", last_login_at: "u.last_login_at IS NULL, u.last_login_at" },
  defaultSort: { by: "full_name", dir: "asc" },
  tieBreaker: "u.id",
  search: { param: "q", columns: ["u.email", "u.username", "u.full_name"] },
};

const USER_FROM = "FROM app_user u LEFT JOIN contact c ON c.id = u.contact_id";
const USER_COLUMNS = `u.id, u.email, u.username, u.password_hash IS NOT NULL AS has_password, u.full_name, u.role, u.contact_id, COALESCE(NULLIF(c.display_name, ''), c.zalo_name) AS contact_name,
  u.all_groups, u.is_active, u.last_login_at, u.created_at,
  (SELECT COUNT(*) FROM user_group_scope s WHERE s.user_id = u.id) AS group_count`;

const FIELD_LABELS = { email: "Email", username: "Tên đăng nhập", has_password: "Có mật khẩu", full_name: "Họ tên", role: "Vai trò", contact_id: "Người trên Zalo", all_groups: "Mọi nhóm", is_active: "Đang dùng", group_ids: "Nhóm được xem" };

function decorate(rows: RowDataPacket[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    ...row, email: row.email ?? "", username: row.username ?? "", has_password: Boolean(row.has_password),
    contact_id: row.contact_id === null ? 0 : Number(row.contact_id), all_groups: Boolean(row.all_groups),
    is_active: Boolean(row.is_active), group_count: Number(row.group_count),
  }));
}

export async function getUserDetail(db: Db, id: number): Promise<Record<string, unknown>> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${USER_COLUMNS} ${USER_FROM} WHERE u.id = ?`, [id]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có người dùng này");
  const [groups] = await db.query<RowDataPacket[]>("SELECT group_id FROM user_group_scope WHERE user_id = ? ORDER BY group_id", [id]);
  return { ...decorate(rows)[0], group_ids: groups.map((row) => Number(row.group_id)) };
}

function invalid(message: string): ApiError {
  return new ApiError(422, "validation_error", message);
}

export interface UserInput {
  /** null = bỏ email (chỉ đăng nhập bằng tên đăng nhập) */
  email?: string | null;
  username?: string | null;
  /** Đã băm; null = gỡ mật khẩu (chỉ đăng nhập Google) */
  passwordHash?: string | null;
  fullName?: string;
  role?: UserRole;
  contactId?: number | null;
  allGroups?: boolean;
  isActive?: boolean;
  groupIds?: number[];
}

function parseBool(raw: unknown, label: string): boolean {
  if (typeof raw === "boolean") return raw;
  throw invalid(`${label} chỉ nhận bật / tắt`);
}

/** Thân POST / PATCH → dữ liệu đã kiểm. `creating` = bắt buộc vai trò + ít nhất email hoặc tên đăng nhập. */
export async function parseUserInput(db: Db, body: Record<string, unknown>, creating: boolean): Promise<UserInput> {
  const input: UserInput = {};
  if (body.email !== undefined) {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (email && !EMAIL_PATTERN.test(email)) throw invalid("Email không hợp lệ");
    input.email = email || null;
  }
  if (body.username !== undefined) {
    const username = String(body.username ?? "").trim().toLowerCase();
    if (username && !USERNAME_PATTERN.test(username)) throw invalid("Tên đăng nhập 3–100 ký tự: chữ thường không dấu, số, . _ @ -");
    input.username = username || null;
  }
  if (creating && !input.email && !input.username) throw invalid("Cần email (đăng nhập Google) hoặc tên đăng nhập");
  if (body.password !== undefined && body.password !== "") {
    const password = String(body.password);
    if (password.length < PASSWORD_MIN || password.length > MAX_PASSWORD_LENGTH) throw invalid(`Mật khẩu ${PASSWORD_MIN}–${MAX_PASSWORD_LENGTH} ký tự`);
    input.passwordHash = await hashPassword(password);
  }
  if (body.remove_password === true) input.passwordHash = null;
  if (body.full_name !== undefined) {
    const name = String(body.full_name).trim();
    if (name.length > NAME_MAX) throw invalid(`Họ tên tối đa ${NAME_MAX} ký tự`);
    input.fullName = name;
  }
  if (body.role !== undefined || creating) {
    const role = Number(body.role);
    if (!Object.values(UserRole).includes(role)) throw invalid("Vai trò không hợp lệ");
    input.role = role as UserRole;
  }
  if (body.contact_id !== undefined) {
    const contactId = Number(body.contact_id);
    if (!contactId) input.contactId = null;
    else {
      const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM contact WHERE id = ?", [contactId]);
      if (!rows[0]) throw invalid("Không có người này trong Danh bạ");
      input.contactId = contactId;
    }
  }
  if (body.all_groups !== undefined) input.allGroups = parseBool(body.all_groups, "Mọi nhóm");
  if (body.is_active !== undefined) input.isActive = parseBool(body.is_active, "Đang dùng");
  if (body.group_ids !== undefined) {
    if (!Array.isArray(body.group_ids) || body.group_ids.length > MAX_SCOPE_GROUPS) throw invalid(`Nhóm được xem phải là danh sách (tối đa ${MAX_SCOPE_GROUPS})`);
    const ids = [...new Set(body.group_ids.map(Number))];
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw invalid("Mã nhóm không hợp lệ");
    if (ids.length) {
      const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM zalo_group WHERE id IN (?) AND thread_type = ?", [ids, ConversationType.Group]);
      if (rows.length !== ids.length) throw invalid("Có nhóm không tồn tại trong danh sách nhóm được xem");
    }
    input.groupIds = ids.sort((a, b) => a - b);
  }
  return input;
}

async function saveScope(db: Db, userId: number, groupIds: number[]): Promise<void> {
  await db.query("DELETE FROM user_group_scope WHERE user_id = ?", [userId]);
  if (groupIds.length) await db.query("INSERT INTO user_group_scope (user_id, group_id) VALUES ?", [groupIds.map((id) => [userId, id])]);
}

async function assertLoginFree(db: Db, input: UserInput, exceptId: number): Promise<void> {
  if (input.email) {
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM app_user WHERE email = ? AND id <> ?", [input.email, exceptId]);
    if (rows[0]) throw invalid("Email này đã có người dùng khác");
  }
  if (input.username) {
    // Tên đăng nhập cũng không được trùng email của người khác — ô đăng nhập nhận cả hai
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM app_user WHERE (username = ? OR email = ?) AND id <> ?",
      [input.username, input.username, exceptId]);
    if (rows[0]) throw invalid("Tên đăng nhập này đã có người dùng khác");
  }
}

export const userRoutes: ApiRoute[] = [
  ["GET", /^\/api\/users$/, async ({ response, url, service, principal }) => sendOk(response, await runList(service.db, url.searchParams, USER_LIST_SPEC, {
    select: USER_COLUMNS, from: USER_FROM, baseWhere: { sql: "u.tenant_id = ?", params: [principal.tenantId] }, decorate,
  }))],
  ["GET", /^\/api\/users\/(\d+)$/, async ({ response, match, service }) => sendOk(response, await getUserDetail(service.db, parseId(match[1])))],
  ["POST", /^\/api\/users$/, async ({ request, response, service, principal }) => {
    const db = service.db;
    const input = await parseUserInput(db, await readJson(request), true);
    await assertLoginFree(db, input, 0);
    const [result] = await db.query<any>(
      `INSERT INTO app_user (tenant_id, email, username, password_hash, full_name, role, contact_id, all_groups, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [principal.tenantId, input.email ?? null, input.username ?? null, input.passwordHash ?? null, input.fullName ?? "", input.role,
        input.contactId ?? null, input.allGroups ? 1 : 0, input.isActive === false ? 0 : 1]);
    const id = Number(result.insertId);
    if (input.groupIds) await saveScope(db, id, input.groupIds);
    await recordAudit(db, { entity: "user", entityId: id, action: "create", message: `Thêm người dùng ${input.username ?? input.email}` });
    sendOk(response, await getUserDetail(db, id), "Đã thêm người dùng", 201);
  }],
  ["PATCH", /^\/api\/users\/(\d+)$/, async ({ request, response, match, service, sessions }) => {
    const db = service.db;
    const id = parseId(match[1]);
    const before = await getUserDetail(db, id);
    const input = await parseUserInput(db, await readJson(request), false);
    await assertLoginFree(db, input, id);
    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => { sets.push(`${column} = ?`); values.push(value); };
    if (input.email !== undefined) set("email", input.email);
    if (input.username !== undefined) set("username", input.username);
    if (input.passwordHash !== undefined) set("password_hash", input.passwordHash);
    if (input.fullName !== undefined) set("full_name", input.fullName);
    if (input.role !== undefined) set("role", input.role);
    if (input.contactId !== undefined) set("contact_id", input.contactId);
    if (input.allGroups !== undefined) set("all_groups", input.allGroups ? 1 : 0);
    if (input.isActive !== undefined) set("is_active", input.isActive ? 1 : 0);
    if (sets.length) await db.query(`UPDATE app_user SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);
    if (input.groupIds) await saveScope(db, id, input.groupIds);
    const after = await getUserDetail(db, id);
    const changed = diffFields(before, after, FIELD_LABELS);
    // Đặt lại mật khẩu (cùng / khác trạng thái «có mật khẩu») vẫn là một thay đổi — ghi nhật ký, đá phiên cũ
    if (input.passwordHash && !changed.includes("Mật khẩu")) changed.push("Mật khẩu");
    // Quyền / phạm vi đổi thì phiên đang mở phải đăng nhập lại để nhận quyền mới (tắt tài khoản = văng ngay)
    if (changed.some((label) => ["Vai trò", "Mọi nhóm", "Đang dùng", "Nhóm được xem", "Email", "Tên đăng nhập", "Mật khẩu", "Có mật khẩu"].includes(label))) {
      await sessions.revokeUser(id);
    }
    if (changed.length) await recordAudit(db, { entity: "user", entityId: id, action: "update", changedFields: changed });
    sendOk(response, after, changed.length ? "Đã lưu người dùng" : "Không có gì thay đổi");
  }],
];
