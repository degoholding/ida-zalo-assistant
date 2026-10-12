import assert from "node:assert/strict";
import { test } from "node:test";
import { permissionsFor, type Principal } from "../../auth/principal.js";
import { UserRole } from "../../constants.js";
import { requiredPermission } from "./route-permissions.js";
import { buildVnDayCondition, commandScopeWhere, SEND_COMMAND_LIST_SPEC } from "./send-commands-api.js";

const principal = (role: UserRole, userId: number | null = 7): Principal => ({ userId, tenantId: 1, fullName: "A", email: "", role, groupIds: null });

test("buildVnDayCondition: lấy trọn ngày theo giờ Việt Nam, rác / thiếu vế thì bỏ lọc", () => {
  const start = new Date("2026-10-04T17:00:00Z");
  const next = new Date("2026-10-05T17:00:00Z");
  assert.deepEqual(buildVnDayCondition("c.created_at", "eq", ["2026-10-05"]), { sql: "(c.created_at >= ? AND c.created_at < ?)", params: [start, next] });
  assert.deepEqual(buildVnDayCondition("c.scheduled_at", "lte", ["2026-10-05"]), { sql: "c.scheduled_at < ?", params: [next] });
  assert.equal(buildVnDayCondition("c.created_at", "between", ["2026-10-01"]), null);
  assert.equal(buildVnDayCondition("c.created_at", "eq", ["rác"]), null);
  assert.equal(buildVnDayCondition("c.created_at", "isnull", ["1"]), null);
});

test("ListSpec: mọi bộ lọc / cột sắp xếp / ô tìm màn «Gửi tin» dùng đều đã khai", () => {
  for (const key of ["status", "source", "requester_uid", "created_at", "scheduled_at"]) assert.ok(SEND_COMMAND_LIST_SPEC.fields[key], key);
  for (const key of ["created_at", "scheduled_at"]) assert.ok(SEND_COMMAND_LIST_SPEC.sorts[key], key);
  assert.deepEqual(SEND_COMMAND_LIST_SPEC.search?.columns, ["c.requester_name", "c.body"]);
});

test("commandScopeWhere: quản trị chỉ bị giới hạn tenant; vai trò khác khóa theo liên hệ gắn tài khoản, lệnh web (uid rỗng) không lộ", () => {
  const admin = commandScopeWhere(principal(UserRole.Admin));
  assert.deepEqual(admin, { sql: "c.tenant_id = ?", params: [1] });
  const manager = commandScopeWhere(principal(UserRole.Manager, 9));
  assert.match(manager.sql, /c\.requester_uid <> ''/);
  assert.match(manager.sql, /app_user u JOIN contact ct ON ct\.id = u\.contact_id WHERE u\.id = \?/);
  assert.deepEqual(manager.params, [1, 9]);
  // userId null (không có phiên) không bao giờ khớp người thật
  assert.deepEqual(commandScopeWhere(principal(UserRole.Staff, null)).params, [1, 0]);
});

test("quyền: Quản lý / Nhân viên xem + hủy lệnh của mình; Tắt / Bật bot không khai nên chỉ quản trị; đọc tình trạng bot theo quyền hội thoại", () => {
  for (const role of [UserRole.Admin, UserRole.Manager, UserRole.Staff]) {
    assert.deepEqual([permissionsFor(role).send_command.read, permissionsFor(role).send_command.write], [true, true]);
  }
  assert.deepEqual(requiredPermission("GET", "/api/send-commands"), { entity: "send_command", action: "read" });
  assert.deepEqual(requiredPermission("GET", "/api/send-commands/12"), { entity: "send_command", action: "read" });
  assert.deepEqual(requiredPermission("POST", "/api/send-commands/12/actions"), { entity: "send_command", action: "write" });
  assert.deepEqual(requiredPermission("GET", "/api/bot-halt"), { entity: "conversation", action: "read" });
  assert.deepEqual(requiredPermission("POST", "/api/bot-halt"), { entity: "setting", action: "write" });
});
