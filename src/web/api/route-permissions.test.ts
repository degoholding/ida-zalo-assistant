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

test("tắt / bật lưu một cuộc riêng 1-1 chỉ quản trị — không lọt vào quyền gửi tin của Hội thoại (27/10/2026)", () => {
  assert.deepEqual(requiredPermission("PATCH", "/api/conversations/7"), { entity: "setting", action: "write" });
  assert.deepEqual(requiredPermission("POST", "/api/conversations/7/messages"), { entity: "conversation", action: "write" });
});

test("thống kê dùng MCP chỉ quản trị — không lọt vào quyền Khóa MCP của Quản lý (phase 13.6)", () => {
  assert.deepEqual(requiredPermission("GET", "/api/mcp-usage"), { entity: "setting", action: "write" });
  assert.deepEqual(requiredPermission("GET", "/api/mcp-keys"), { entity: "mcp_key", action: "read" });
});

test("tab Link chia sẻ của màn Tệp (phase 13.2) dùng quyền xem tệp; không có đường ghi", () => {
  assert.deepEqual(requiredPermission("GET", "/api/files/links"), { entity: "file", action: "read" });
  assert.deepEqual(requiredPermission("POST", "/api/files/links"), { entity: "setting", action: "write" });
});
