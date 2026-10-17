import assert from "node:assert/strict";
import { test } from "node:test";
import { McpAccessLevel, McpCallSource, McpCallStatus, UserRole } from "../constants.js";
import { maxAccessLevelForRole } from "./mcp-api-key-store.js";

test("mã số MCP khớp bản chép ở web (web/src/modules/mcp-keys/types/mcp-key.ts)", () => {
  assert.deepEqual([McpAccessLevel.Read, McpAccessLevel.ReadWrite], [1, 2]);
  assert.deepEqual([McpCallStatus.Ok, McpCallStatus.Denied, McpCallStatus.Invalid, McpCallStatus.Error, McpCallStatus.RateLimited], [0, 1, 2, 3, 4]);
  assert.deepEqual([McpCallSource.Http, McpCallSource.Assistant], [1, 2]);
});

test("maxAccessLevelForRole: Nhân viên chỉ đọc; Quản lý / Quản trị được đọc + ghi", () => {
  assert.equal(maxAccessLevelForRole(UserRole.Staff), McpAccessLevel.Read);
  assert.equal(maxAccessLevelForRole(UserRole.Manager), McpAccessLevel.ReadWrite);
  assert.equal(maxAccessLevelForRole(UserRole.Admin), McpAccessLevel.ReadWrite);
});
