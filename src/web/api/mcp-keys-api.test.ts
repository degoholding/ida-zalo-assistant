import assert from "node:assert/strict";
import { test } from "node:test";
import { McpAccessLevel, UserRole } from "../../constants.js";
import type { Principal } from "../../auth/principal.js";
import { ApiError } from "./api-http.js";
import { keyScopeWhere, MCP_KEY_LIST_SPEC, parseCreateKeyInput } from "./mcp-keys-api.js";

const person = (role: UserRole, extra: Partial<Principal> = {}): Principal =>
  ({ userId: 7, tenantId: 1, fullName: "A", email: "a@x.vn", role, groupIds: null, ...extra });

const rejects = (body: Record<string, unknown>, principal: Principal, status: number, pattern: RegExp) =>
  assert.throws(() => parseCreateKeyInput(body, principal), (error) => error instanceof ApiError && error.status === status && pattern.test(error.message));

test("parseCreateKeyInput: đầu vào hợp lệ được cắt khoảng trắng tên", () => {
  const input = parseCreateKeyInput({ name: "  Claude văn phòng ", access_level: 1, expires_in_days: 90 }, person(UserRole.Staff));
  assert.deepEqual(input, { name: "Claude văn phòng", accessLevel: McpAccessLevel.Read, includeConfidential: false, days: 90 });
  assert.equal(parseCreateKeyInput({ name: "k", access_level: 1 }, person(UserRole.Staff)).days, null);
});

test("parseCreateKeyInput: tên rỗng / quá dài / mức lạ / hạn lạ bị từ chối", () => {
  const staff = person(UserRole.Staff);
  rejects({ name: "   ", access_level: 1 }, staff, 422, /Tên khóa/);
  rejects({ name: "x".repeat(101), access_level: 1 }, staff, 422, /Tên khóa/);
  rejects({ name: "k", access_level: 9 }, staff, 422, /Mức quyền/);
  rejects({ name: "k", access_level: "1; DROP" }, staff, 422, /Mức quyền/);
  rejects({ name: "k", access_level: 1, expires_in_days: 7 }, staff, 422, /Hạn khóa/);
  rejects({ name: "k", access_level: 1, include_confidential: "yes" }, staff, 422, /bật \/ tắt/);
});

test("parseCreateKeyInput: Nhân viên không tạo được khóa đọc + ghi; Quản lý thì được", () => {
  rejects({ name: "k", access_level: 2 }, person(UserRole.Staff), 403, /chỉ đọc/);
  assert.equal(parseCreateKeyInput({ name: "k", access_level: 2 }, person(UserRole.Manager)).accessLevel, McpAccessLevel.ReadWrite);
});

test("parseCreateKeyInput: khóa đọc nhóm Mật cần cờ Mật của chính người tạo (quản trị cũng vậy)", () => {
  rejects({ name: "k", access_level: 1, include_confidential: true }, person(UserRole.Admin), 422, /nhóm Mật/);
  const allowed = parseCreateKeyInput({ name: "k", access_level: 1, include_confidential: true }, person(UserRole.Staff, { canViewConfidential: true }));
  assert.equal(allowed.includeConfidential, true);
});

test("keyScopeWhere: chỉ quản trị bật scope=all mới thấy khóa người khác", () => {
  assert.deepEqual(keyScopeWhere(person(UserRole.Admin), true).params, [1]);
  assert.deepEqual(keyScopeWhere(person(UserRole.Admin), false).params, [1, 7]);
  // Nhân viên gõ tay scope=all vẫn bị khóa cứng theo user_id
  assert.deepEqual(keyScopeWhere(person(UserRole.Staff), true).params, [1, 7]);
  assert.match(keyScopeWhere(person(UserRole.Manager), true).sql, /user_id = \?/);
});

test("MCP_KEY_LIST_SPEC: không cột nào sắp xếp / lọc / tìm tới token_hash", () => {
  const exposed = JSON.stringify([MCP_KEY_LIST_SPEC.sorts, MCP_KEY_LIST_SPEC.search, Object.values(MCP_KEY_LIST_SPEC.fields).map((field) => field.sql)]);
  assert.doesNotMatch(exposed, /token_hash/);
  const status = MCP_KEY_LIST_SPEC.fields.status;
  assert.equal(status.build?.("eq", ["bogus"]), null);
  assert.match(status.build?.("eq", ["revoked"])?.sql ?? "", /revoked_at IS NOT NULL/);
});
