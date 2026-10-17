import assert from "node:assert/strict";
import { test } from "node:test";
import { UserRole } from "../constants.js";
import { requiredPermission } from "../web/api/route-permissions.js";
import { can, canSeeConfidential, ENTITIES, groupScopeSql, SYSTEM_PRINCIPAL, permissionsFor, permissionsForPrincipal, type Principal } from "./principal.js";

const user = (role: UserRole, groupIds: number[] | null = [3]): Principal => ({ userId: 9, tenantId: 1, fullName: "A", email: "a@x.vn", role, groupIds });

test("an admin can do everything, including users, recipients and settings", () => {
  for (const entity of ["setting", "user", "recipient", "bot_account", "audit", "group"] as const) {
    assert.equal(can(SYSTEM_PRINCIPAL, entity, "write"), true, entity);
  }
});

test("a manager reads and edits data in scope but never touches admin-only areas", () => {
  const manager = user(UserRole.Manager);
  assert.equal(can(manager, "group", "write"), true);
  assert.equal(can(manager, "conversation", "write"), true);
  assert.equal(can(manager, "company", "write"), false);
  for (const entity of ["setting", "user", "recipient", "bot_account", "audit"] as const) {
    assert.equal(can(manager, entity, "read"), false, entity);
  }
});

test("staff can only read", () => {
  const staff = user(UserRole.Staff);
  assert.equal(can(staff, "file", "read"), true);
  for (const entity of ["file", "group", "contact", "conversation"] as const) assert.equal(can(staff, entity, "write"), false, entity);
  assert.equal(permissionsFor(UserRole.Staff).file.export, false);
});

test("every API path maps to a permission, and unknown or admin paths fall back to admin-only", () => {
  assert.deepEqual(requiredPermission("GET", "/api/groups"), { entity: "group", action: "read" });
  assert.deepEqual(requiredPermission("PATCH", "/api/groups/5"), { entity: "group", action: "write" });
  assert.deepEqual(requiredPermission("POST", "/api/groups/5/backfill"), { entity: "group", action: "write" });
  assert.deepEqual(requiredPermission("GET", "/api/files/7/download"), { entity: "file", action: "read" });
  assert.deepEqual(requiredPermission("PATCH", "/api/files/7"), { entity: "file", action: "write" });
  assert.deepEqual(requiredPermission("GET", "/api/settings"), { entity: "setting", action: "write" });
  assert.deepEqual(requiredPermission("GET", "/api/ai-keys"), { entity: "setting", action: "write" });
  assert.deepEqual(requiredPermission("POST", "/api/assistant-chat/messages"), { entity: "setting", action: "write" });
  assert.deepEqual(requiredPermission("GET", "/api/something-new"), { entity: "setting", action: "write" });
  assert.deepEqual(requiredPermission("POST", "/api/recipients/2/test"), { entity: "recipient", action: "write" });
  // Đường giống mà không khớp hẳn (thêm đuôi lạ) không được lọt sang quyền đọc của nhóm
  assert.deepEqual(requiredPermission("POST", "/api/groupsX"), { entity: "setting", action: "write" });
});

test("scope SQL: everything for admins, nothing for an empty scope, an IN list otherwise", () => {
  assert.equal(groupScopeSql(SYSTEM_PRINCIPAL, "g.id"), null);
  assert.deepEqual(groupScopeSql(user(UserRole.Staff, []), "g.id"), { sql: "1 = 0", params: [] });
  assert.deepEqual(groupScopeSql(user(UserRole.Staff, [3, 4]), "g.id"), { sql: "g.id IN (?)", params: [[3, 4]] });
});

test("phase 10 matrix: reply templates for everyone (managers approve), metrics and catalog for managers only", () => {
  const staff = user(UserRole.Staff);
  const manager = user(UserRole.Manager);
  for (const actor of [staff, manager, SYSTEM_PRINCIPAL]) {
    for (const action of ["read", "write", "create"] as const) assert.equal(can(actor, "reply_template", action), true, `${actor.role}.${action}`);
  }
  assert.equal(can(staff, "reply_template", "approve"), false);
  assert.equal(can(manager, "reply_template", "approve"), true);
  assert.equal(can(SYSTEM_PRINCIPAL, "catalog", "approve"), true);
  for (const entity of ["metric", "catalog"] as const) {
    assert.equal(can(staff, entity, "read"), false, `staff ${entity}`);
    assert.equal(can(manager, entity, "read"), true, `manager ${entity}`);
    assert.equal(can(manager, entity, "write"), false, `manager write ${entity}`);
    assert.equal(can(manager, entity, "approve"), false, `manager approve ${entity}`);
  }
  assert.equal(can(manager, "metric", "export"), true);
  assert.equal(can(manager, "catalog", "export"), false);
  // Nút «Thêm nguồn số liệu» (khung CRUD gác bằng create): chỉ quản trị; Quản lý / Nhân viên không
  assert.equal(can(SYSTEM_PRINCIPAL, "metric", "create"), true);
  assert.equal(can(manager, "metric", "create"), false);
  assert.equal(can(staff, "metric", "create"), false);
  assert.equal(can(SYSTEM_PRINCIPAL, "catalog", "create"), false);
});

test("phase 10 routes: reply templates by write, metrics / catalog reads by read, sources and catalog writes admin-only", () => {
  assert.deepEqual(requiredPermission("GET", "/api/reply-templates"), { entity: "reply_template", action: "read" });
  assert.deepEqual(requiredPermission("POST", "/api/reply-templates"), { entity: "reply_template", action: "write" });
  assert.deepEqual(requiredPermission("PATCH", "/api/reply-templates/4"), { entity: "reply_template", action: "write" });
  assert.deepEqual(requiredPermission("POST", "/api/reply-templates/4/actions"), { entity: "reply_template", action: "write" });
  assert.deepEqual(requiredPermission("GET", "/api/metrics/summary"), { entity: "metric", action: "read" });
  assert.deepEqual(requiredPermission("GET", "/api/catalog"), { entity: "catalog", action: "read" });
  assert.deepEqual(requiredPermission("POST", "/api/catalog/import"), { entity: "setting", action: "write" });
  assert.deepEqual(requiredPermission("GET", "/api/metric-sources"), { entity: "setting", action: "write" });
  assert.deepEqual(requiredPermission("POST", "/api/metric-sources/2/sync"), { entity: "setting", action: "write" });
});

test("audit.read: Nhân viên / Quản lý có cờ canViewAudit thì được, không cờ thì không; quản trị luôn được", () => {
  for (const role of [UserRole.Staff, UserRole.Manager]) {
    assert.equal(can(user(role), "audit", "read"), false, `${role} không cờ`);
    assert.equal(can({ ...user(role), canViewAudit: true }, "audit", "read"), true, `${role} có cờ`);
    assert.equal(permissionsForPrincipal({ ...user(role), canViewAudit: true }).audit.read, true);
    // cờ chỉ mở ĐỌC nhật ký, không mở ghi
    assert.equal(can({ ...user(role), canViewAudit: true }, "audit", "write"), false);
  }
  assert.equal(can(user(UserRole.Admin), "audit", "read"), true);
  assert.equal(permissionsForPrincipal(user(UserRole.Staff)).audit.read, false);
});

test("permissionsForPrincipal không làm bẩn ma trận gốc của vai trò", () => {
  permissionsForPrincipal({ ...user(UserRole.Staff), canViewAudit: true });
  assert.equal(permissionsFor(UserRole.Staff).audit.read, false);
});

test("canSeeConfidential: chỉ khi cờ bật, KHÔNG tự cho quản trị", () => {
  assert.equal(canSeeConfidential(user(UserRole.Admin)), false);
  assert.equal(canSeeConfidential(SYSTEM_PRINCIPAL), false);
  assert.equal(canSeeConfidential({ ...user(UserRole.Staff), canViewConfidential: false }), false);
  assert.equal(canSeeConfidential({ ...user(UserRole.Staff), canViewConfidential: true }), true);
});

test("mcp_key: mọi vai trò xem / sửa / tạo; luật đường /api/mcp-keys khớp", () => {
  for (const role of [UserRole.Admin, UserRole.Manager, UserRole.Staff]) {
    const principal = user(role);
    for (const action of ["read", "write", "create"] as const) assert.equal(can(principal, "mcp_key", action), true, `${role} ${action}`);
    assert.equal(can(principal, "mcp_key", "approve"), role === UserRole.Admin);
  }
  assert.deepEqual(requiredPermission("GET", "/api/mcp-keys"), { entity: "mcp_key", action: "read" });
  assert.deepEqual(requiredPermission("POST", "/api/mcp-keys"), { entity: "mcp_key", action: "write" });
  assert.deepEqual(requiredPermission("POST", "/api/mcp-keys/5/revoke"), { entity: "mcp_key", action: "write" });
  // đường lạ dưới /api/mcp-keys vẫn rơi về «chỉ quản trị»
  assert.deepEqual(requiredPermission("POST", "/api/mcp-keys/5/delete"), { entity: "setting", action: "write" });
});

test("ENTITIES: mcp_key nằm CUỐI mảng (web chép cùng thứ tự)", () => {
  assert.equal(ENTITIES[ENTITIES.length - 1], "mcp_key");
});
