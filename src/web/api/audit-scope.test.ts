import assert from "node:assert/strict";
import { test } from "node:test";
import { UserRole } from "../../constants.js";
import type { Principal } from "../../auth/principal.js";
import { auditScopeSql } from "./audit-scope.js";

const base = { userId: 7, tenantId: 1, fullName: "Người thử", email: "t@example.com" };
const adminP: Principal = { ...base, userId: 1, role: UserRole.Admin, groupIds: null };
const managerP: Principal = { ...base, role: UserRole.Manager, groupIds: [11, 12], canViewAudit: true };
const staffP: Principal = { ...base, role: UserRole.Staff, groupIds: [11, 12], canViewAudit: true };
const staffAllGroups: Principal = { ...base, role: UserRole.Staff, groupIds: null, canViewAudit: true };
const staffNoGroups: Principal = { ...base, role: UserRole.Staff, groupIds: [], canViewAudit: true };

/** Tên thực thể (tham số `a.entity = ?`) có nhánh trong điều kiện. */
function entitiesOf(part: { sql: string; params: unknown[] }): string[] {
  return part.params.filter((param): param is string => typeof param === "string" && /^[a-z_]+$/.test(param));
}
const placeholders = (sql: string) => (sql.match(/\?/g) ?? []).length;

test("quản trị + được Mật → không giới hạn (null)", () => {
  assert.equal(auditScopeSql(adminP, true), null);
});

test("quản trị không Mật: thấy mọi loại bản ghi nhưng ẩn dòng của nhóm / tệp / việc / ticket / lệnh gắn nhóm Mật", () => {
  const part = auditScopeSql(adminP, false)!;
  const entities = entitiesOf(part);
  for (const entity of ["group", "file", "contact", "task", "ticket", "send_command", "company", "reply_template", "catalog", "metric_source", "user", "recipient", "setting", "bot_account", "mcp_key"]) {
    assert.ok(entities.includes(entity), entity);
  }
  assert.equal((part.sql.match(/zg\.is_confidential = 1/g) ?? []).length, 5);
  assert.equal(placeholders(part.sql), part.params.length);
});

test("Quản lý được cấp cờ xem nhật ký: chỉ dòng trong phạm vi nhóm; không có người dùng / cài đặt / tài khoản bot", () => {
  const part = auditScopeSql(managerP, true)!;
  const entities = entitiesOf(part);
  assert.ok(entities.includes("group") && entities.includes("catalog") && entities.includes("metric_source") && entities.includes("mcp_key"));
  for (const entity of ["user", "recipient", "setting", "bot_account"]) assert.ok(!entities.includes(entity), entity);
  assert.match(part.sql, /\(a\.entity = \? AND a\.entity_id IN \(\?\)\)/);
  assert.match(part.sql, /EXISTS \(SELECT 1 FROM attachment at WHERE at\.id = a\.entity_id AND at\.group_id IN \(\?\)\)/);
  assert.match(part.sql, /EXISTS \(SELECT 1 FROM task t WHERE t\.id = a\.entity_id AND t\.source_thread_id IN \(\?\)\)/);
  assert.match(part.sql, /EXISTS \(SELECT 1 FROM ticket t WHERE t\.id = a\.entity_id AND t\.source_thread_id IN \(\?\)\)/);
  assert.match(part.sql, /EXISTS \(SELECT 1 FROM contact c WHERE c\.id = a\.entity_id AND EXISTS \(SELECT 1 FROM group_member gm/);
  assert.equal(part.params.filter((param) => Array.isArray(param)).length >= 5, true);
  assert.deepEqual(part.params.filter((param) => Array.isArray(param))[0], [11, 12]);
  assert.equal(placeholders(part.sql), part.params.length);
  // Có Mật thì không có điều kiện loại nhóm Mật
  assert.doesNotMatch(part.sql, /zg\.is_confidential/);
});

test("Nhân viên được cấp cờ: không thấy Danh mục / nguồn số liệu; lệnh gửi chỉ của chính mình; khóa MCP chỉ của mình", () => {
  const part = auditScopeSql(staffP, false)!;
  const entities = entitiesOf(part);
  assert.ok(!entities.includes("catalog") && !entities.includes("metric_source") && !entities.includes("user"));
  assert.ok(entities.includes("company") && entities.includes("reply_template"));
  assert.match(part.sql, /c\.requester_uid = \(SELECT ct\.zalo_uid FROM app_user u/);
  assert.match(part.sql, /FROM mcp_api_key k WHERE k\.id = a\.entity_id AND k\.user_id = \?/);
  assert.ok(part.params.includes(7));
  assert.match(part.sql, /zg\.is_confidential = 1/);
  assert.equal(placeholders(part.sql), part.params.length);
});

test("người «mọi nhóm» không bị khoanh nhóm nhưng vẫn bị giới hạn theo loại bản ghi", () => {
  const part = auditScopeSql(staffAllGroups, true)!;
  assert.doesNotMatch(part.sql, /entity_id IN \(\?\)/);
  assert.ok(!entitiesOf(part).includes("user"));
});

test("danh sách nhóm rỗng → các nhánh gắn nhóm là 1 = 0", () => {
  const part = auditScopeSql(staffNoGroups, true)!;
  assert.match(part.sql, /\(a\.entity = \? AND 1 = 0\)/);
});

test("giá trị luôn qua tham số: không chuỗi thực thể nào nằm trong SQL", () => {
  const part = auditScopeSql(managerP, false)!;
  for (const entity of entitiesOf(part)) assert.doesNotMatch(part.sql, new RegExp(`'${entity}'`));
});
