import assert from "node:assert/strict";
import { test } from "node:test";
import { admin, makeCtx, manager, staff } from "./data-access-test-support.js";
import type { EntityDefinition } from "./entity-definition.js";
import { ENTITY_DEFINITIONS } from "./entity-registry.js";
import { FORBIDDEN_PATTERNS, findForbiddenReferences } from "./forbidden-columns.js";

const contexts = [
  ["quản trị", makeCtx(admin())], ["quản trị + Mật", makeCtx(admin({ canViewConfidential: true }))],
  ["quản lý", makeCtx(manager({ canViewAudit: true }))], ["nhân viên", makeCtx(staff({ canViewAudit: true }))],
] as const;

test("KHÔNG định nghĩa thực thể nào nhắc tới cột / bảng bí mật (mọi vai trò, mọi biến thể spec)", () => {
  const hits: string[] = [];
  for (const [label, ctx] of contexts) {
    for (const def of ENTITY_DEFINITIONS) hits.push(...findForbiddenReferences(def, ctx).map((hit) => `[${label}] ${hit}`));
  }
  assert.deepEqual(hits, []);
});

test("mẫu cấm phủ đủ: password_hash, token_hash, session_cipher, secret, refresh_token, app_setting, web_session, ai_key, mcp_api_key, bot_account", () => {
  const covers = (text: string) => FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text));
  for (const name of ["u.password_hash", "k.token_hash", "b.session_cipher", "ai_key.secret", "o.refresh_token", "app_setting", "web_session", "ai_key_usage", "mcp_api_key", "bot_account b", "google_oauth_token", "a.storage_key", "a.source_url"]) {
    assert.ok(covers(name), name);
  }
  // Cột / bảng bình thường không bị cấm nhầm
  for (const name of ["g.name", "m.sender_name", "audit_log a", "c.display_name", "secretary"]) assert.equal(covers(name), false, name);
  // Lọc theo tài khoản Zalo (27/10/2026): cột khóa ngoại bot_group.bot_account_id được dùng, BẢNG bot_account vẫn cấm
  assert.equal(covers("bga.bot_account_id IN (?)"), false);
  for (const name of ["JOIN bot_account b", "bot_account.session_cipher", "FROM bot_account"]) assert.ok(covers(name), name);
});

const sample = (override: Partial<EntityDefinition>): EntityDefinition => ({
  name: "demo", title: "Demo", permission: "group", from: "zalo_group g",
  spec: () => ({ fields: { name: { sql: "g.name", type: "text" } }, sorts: { name: "g.name" }, defaultSort: { by: "name", dir: "asc" }, tieBreaker: "g.id" }),
  columns: { id: { sql: "g.id", type: "number" } }, defaultFields: ["id"], baseWhere: () => undefined, ...override,
});

test("bộ dò bắt được vi phạm ở cột, FROM, spec lọc / sắp xếp / tìm, điều kiện cố định và hàm build", () => {
  const ctx = makeCtx(admin());
  assert.deepEqual(findForbiddenReferences(sample({}), ctx), []);
  assert.equal(findForbiddenReferences(sample({ columns: { id: { sql: "g.id", type: "number" }, h: { sql: "u.password_hash", type: "text" } } }), ctx).length, 1);
  assert.equal(findForbiddenReferences(sample({ from: "zalo_group g JOIN web_session s ON s.x = g.id" }), ctx).length, 1);
  assert.equal(findForbiddenReferences(sample({ baseWhere: () => ({ sql: "g.id IN (SELECT 1 FROM app_setting)", params: [] }) }), ctx).length, 1);
  assert.equal(findForbiddenReferences(sample({
    spec: () => ({ fields: { f: { sql: "g.ai_key", type: "text" } }, sorts: { s: "bot_account.id" }, defaultSort: { by: "s", dir: "asc" }, tieBreaker: "g.id", search: { param: "q", columns: ["g.secret"] } }),
  }), ctx).length, 3);
  const viaBuild = sample({
    spec: () => ({ fields: { f: { type: "text", build: () => ({ sql: "EXISTS (SELECT 1 FROM mcp_api_key)", params: [] }) } }, sorts: { n: "g.name" }, defaultSort: { by: "n", dir: "asc" }, tieBreaker: "g.id" }),
  });
  assert.ok(findForbiddenReferences(viaBuild, ctx).some((hit) => hit.includes("build")));
});

test("ngoại lệ duy nhất: điều kiện phạm vi của audit_log hỏi «khóa MCP của tôi» (không đọc token_hash); thực thể khác thì không", () => {
  const ctx = makeCtx(staff({ canViewAudit: true }));
  const audit = ENTITY_DEFINITIONS.find((def) => def.name === "audit_log")!;
  assert.ok(audit.baseWhere(ctx)!.sql.includes("mcp_api_key"));
  assert.deepEqual(findForbiddenReferences(audit, ctx), []);
  assert.equal(findForbiddenReferences(sample({ baseWhere: () => ({ sql: "EXISTS (SELECT 1 FROM mcp_api_key)", params: [] }) }), ctx).length, 1);
  assert.equal(findForbiddenReferences({ ...audit, columns: { x: { sql: "k.token_hash", type: "text" } } }, ctx).length, 1);
});
