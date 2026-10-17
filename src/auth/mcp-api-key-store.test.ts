import assert from "node:assert/strict";
import { test } from "node:test";
import { McpAccessLevel, McpCallSource, McpCallStatus, UserRole } from "../constants.js";
import { fakeDb } from "../data-access/data-access-test-support.js";
import { generateMcpKey } from "./mcp-api-key-format.js";
import { maxAccessLevelForRole, verifyMcpKey } from "./mcp-api-key-store.js";

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

// verifyMcpKey với «DB» giả: khóa không có cờ Mật không được đọc cả cuộc nhắn riêng của chủ khóa (quyết định chủ 17/10/2026).
function verifyWith(includeConfidential: boolean) {
  const { token, tokenHash } = generateMcpKey();
  const db = fakeDb((sql) => {
    if (/FROM mcp_api_key/.test(sql)) {
      return [{ id: 1, user_id: 9, name: "k", prefix: "p", access_level: 1, include_confidential: includeConfidential ? 1 : 0, created_at: "2026-10-17T00:00:00Z" }];
    }
    if (/FROM app_user WHERE id/.test(sql)) {
      return [{ id: 9, tenant_id: 1, email: "a@b.vn", username: "a", full_name: "A", role: UserRole.Manager, all_groups: 1, can_view_confidential: 1, can_view_audit: 0, is_active: 1 }];
    }
    if (/FROM app_user u JOIN contact c/.test(sql)) return [{ zalo_uid: "u-own" }];
    return [];
  });
  return verifyMcpKey(db.db, token).then((verified) => ({ verified, tokenHash }));
}

test("verifyMcpKey: khóa KHÔNG có include_confidential ẩn cuộc nhắn riêng của chủ khóa (ownDirectUid = null)", async () => {
  const { verified } = await verifyWith(false);
  assert.ok(verified);
  assert.equal(verified.ownDirectUid, null);
  assert.equal(verified.principal.canViewConfidential, false);
});

test("verifyMcpKey: khóa có include_confidential giữ cuộc nhắn riêng của chủ khóa", async () => {
  const { verified } = await verifyWith(true);
  assert.ok(verified);
  assert.equal(verified.ownDirectUid, "u-own");
  assert.equal(verified.principal.canViewConfidential, true);
});
