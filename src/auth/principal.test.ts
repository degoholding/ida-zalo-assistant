import assert from "node:assert/strict";
import { test } from "node:test";
import { UserRole } from "../constants.js";
import { requiredPermission } from "../web/api/route-permissions.js";
import { can, groupScopeSql, SYSTEM_PRINCIPAL, permissionsFor, type Principal } from "./principal.js";

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
  assert.deepEqual(requiredPermission("POST", "/api/groups/5/backfill"), { entity: "setting", action: "write" });
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
