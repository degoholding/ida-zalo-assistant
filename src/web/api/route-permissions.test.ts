import assert from "node:assert/strict";
import { test } from "node:test";
import { requiredPermission } from "./route-permissions.js";

test("Lấy tin cũ cần quyền sửa nhóm (Quản trị + Quản lý), đọc tiến độ cần quyền xem nhóm", () => {
  assert.deepEqual(requiredPermission("POST", "/api/groups/5/backfill"), { entity: "group", action: "write" });
  assert.deepEqual(requiredPermission("GET", "/api/groups/5/backfill"), { entity: "group", action: "read" });
});

test("đường không khai vẫn chỉ quản trị (cài đặt)", () => {
  assert.deepEqual(requiredPermission("POST", "/api/bot-halt"), { entity: "setting", action: "write" });
});
