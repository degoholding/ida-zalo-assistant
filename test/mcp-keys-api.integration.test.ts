// Màn «Khóa MCP» (phase 5) trên MySQL THẬT, đi qua handleApiRequest (phiên + bảng quyền + audit): tạo khóa hiện token một lần,
// phạm vi dòng (người khác → 404, quản trị thấy hết), không vượt mức vai trò, thu hồi + audit, khóa thu hồi không xác thực nữa.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import type http from "node:http";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { SessionStore } from "../src/auth/session-store.js";
import { verifyMcpKey } from "../src/auth/mcp-api-key-store.js";
import { UserRole } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { handleApiRequest, type ApiDeps } from "../src/web/api/api-router.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["mcp_call_log", "mcp_api_key", "audit_log", "web_session", "app_user"];

describe("màn Khóa MCP", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let apiDeps: ApiDeps;
  const tokens: Record<string, string> = {};
  const ids: Record<string, number> = {};

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    const service = { db, config: { google: { loginClientId: "" }, privacy: { allowedAiProviders: ["1"] } } };
    apiDeps = { service: service as unknown as ApiDeps["service"], sessions: new SessionStore(db), qrLogins: {} as ApiDeps["qrLogins"] };
  });
  after(async () => { await db?.end(); });

  async function call(method: string, path: string, who: string, body?: unknown) {
    const request = new PassThrough() as unknown as http.IncomingMessage & PassThrough;
    Object.assign(request, { method, url: path, headers: { host: "localhost" } });
    (request as unknown as PassThrough).end(body === undefined ? undefined : JSON.stringify(body));
    let status = 200;
    let raw = "";
    const response = {
      headersSent: false, setHeader: () => undefined, writeHead: (code: number) => { status = code; return response; },
      end: (chunk?: string) => { raw = chunk ?? ""; }, write: () => true, on: () => response, destroy: () => undefined,
    } as unknown as http.ServerResponse;
    await handleApiRequest({ request, response, url: new URL(path, "http://localhost") }, apiDeps, { token: tokens[who], clientKey: "t", setCookie: (v) => `s=${v}` });
    return { status, raw, body: raw ? JSON.parse(raw) : null };
  }

  async function addUser(name: string, role: UserRole, confidential = false): Promise<void> {
    const [result] = await db.query<any>("INSERT INTO app_user (username, email, full_name, role, all_groups, can_view_confidential, is_active) VALUES (?, ?, ?, ?, 1, ?, 1)",
      [name, `${name}@ida.vn`, name, role, confidential ? 1 : 0]);
    ids[name] = Number(result.insertId);
    tokens[name] = await apiDeps.sessions.create(ids[name]);
  }

  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    await addUser("quantri", UserRole.Admin);
    await addUser("quanly", UserRole.Manager);
    await addUser("nhanvien", UserRole.Staff);
    await addUser("nhanvienmat", UserRole.Staff, true);
  });

  test("create returns the raw token once; list and detail never contain it or the hash", async () => {
    const created = await call("POST", "/api/mcp-keys", "nhanvien", { name: "Claude máy tôi", access_level: 1, expires_in_days: 30 });
    assert.equal(created.status, 201, created.raw);
    const token: string = created.body.data.token;
    assert.match(token, /^idamcp_/);
    assert.equal(created.body.data.key.status, "active");
    for (const path of ["/api/mcp-keys", `/api/mcp-keys/${created.body.data.key.id}`]) {
      const read = await call("GET", path, "nhanvien");
      assert.equal(read.status, 200);
      assert.ok(!read.raw.includes(token), "khóa thô lọt vào phản hồi đọc");
      assert.ok(!/token_hash/.test(read.raw));
    }
    assert.ok(await verifyMcpKey(db, token));
    const [audit] = await db.query<RowDataPacket[]>("SELECT action, actor FROM audit_log WHERE entity = 'mcp_key'");
    assert.deepEqual(audit.map((row) => [row.action, row.actor]), [["create", "nhanvien"]]);
  });

  test("a user cannot exceed the role level or request confidential without the flag", async () => {
    assert.equal((await call("POST", "/api/mcp-keys", "nhanvien", { name: "k", access_level: 2 })).status, 403);
    assert.equal((await call("POST", "/api/mcp-keys", "nhanvien", { name: "k", access_level: 1, include_confidential: true })).status, 422);
    assert.equal((await call("POST", "/api/mcp-keys", "quanly", { name: "k", access_level: 2 })).status, 201);
    const mat = await call("POST", "/api/mcp-keys", "nhanvienmat", { name: "k", access_level: 1, include_confidential: true });
    assert.equal(mat.status, 201, mat.raw);
    assert.equal(mat.body.data.key.include_confidential, true);
    const options = await call("GET", "/api/mcp-keys/options", "nhanvien");
    assert.deepEqual([options.body.data.max_access_level, options.body.data.can_include_confidential], [1, false]);
    assert.equal((await call("GET", "/api/mcp-keys/options", "nhanvienmat")).body.data.can_include_confidential, true);
  });

  test("only 10 active keys per user", async () => {
    for (let i = 0; i < 10; i++) assert.equal((await call("POST", "/api/mcp-keys", "nhanvien", { name: `k${i}`, access_level: 1 })).status, 201);
    const extra = await call("POST", "/api/mcp-keys", "nhanvien", { name: "k10", access_level: 1 });
    assert.equal(extra.status, 422);
    assert.match(extra.body.error.message, /10 khóa/);
  });

  test("row scope: others' keys are 404 and cannot be revoked; admin sees all with scope=all and can revoke", async () => {
    const mine = (await call("POST", "/api/mcp-keys", "nhanvien", { name: "của nhân viên", access_level: 1 })).body.data;
    await call("POST", "/api/mcp-keys", "quanly", { name: "của quản lý", access_level: 1 });
    const list = await call("GET", "/api/mcp-keys?scope=all", "nhanvien");
    assert.deepEqual(list.body.data.items.map((item: { name: string }) => item.name), ["của nhân viên"]);
    assert.equal((await call("GET", `/api/mcp-keys/${mine.key.id}`, "quanly")).status, 404);
    assert.equal((await call("POST", `/api/mcp-keys/${mine.key.id}/revoke`, "quanly")).status, 404);
    assert.ok(await verifyMcpKey(db, mine.token), "khóa vẫn sống sau lần thu hồi trái phép");

    assert.equal((await call("GET", "/api/mcp-keys", "quantri")).body.data.total, 0);
    const all = await call("GET", "/api/mcp-keys?scope=all", "quantri");
    assert.equal(all.body.data.total, 2);
    assert.deepEqual(new Set(all.body.data.items.map((item: { owner_name: string }) => item.owner_name)), new Set(["nhanvien", "quanly"]));
    assert.equal((await call("GET", `/api/mcp-keys/${mine.key.id}`, "quantri")).status, 200);
    const revoked = await call("POST", `/api/mcp-keys/${mine.key.id}/revoke`, "quantri");
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.data.status, "revoked");
    assert.equal(await verifyMcpKey(db, mine.token), null);
  });

  test("revoke is idempotent, audited once, and status filter works", async () => {
    const created = (await call("POST", "/api/mcp-keys", "nhanvien", { name: "để thu hồi", access_level: 1 })).body.data;
    await call("POST", "/api/mcp-keys", "nhanvien", { name: "còn dùng", access_level: 1 });
    assert.equal((await call("POST", `/api/mcp-keys/${created.key.id}/revoke`, "nhanvien")).status, 200);
    assert.equal((await call("POST", `/api/mcp-keys/${created.key.id}/revoke`, "nhanvien")).status, 200);
    const [audit] = await db.query<RowDataPacket[]>("SELECT action FROM audit_log WHERE entity = 'mcp_key' AND action = 'revoke'");
    assert.equal(audit.length, 1);
    const active = await call("GET", "/api/mcp-keys?status=active", "nhanvien");
    assert.deepEqual(active.body.data.items.map((item: { name: string }) => item.name), ["còn dùng"]);
    const revokedOnly = await call("GET", "/api/mcp-keys?status=revoked", "nhanvien");
    assert.deepEqual(revokedOnly.body.data.items.map((item: { name: string }) => item.name), ["để thu hồi"]);
  });

  test("detail lists the latest calls of the key", async () => {
    const created = (await call("POST", "/api/mcp-keys", "nhanvien", { name: "k", access_level: 1 })).body.data;
    await db.query("INSERT INTO mcp_call_log (user_id, key_id, source, tool, entity, args_hash, status, row_count) VALUES (?, ?, 1, 'query_records', 'ticket', ?, 0, 3)",
      [ids.nhanvien, created.key.id, "a".repeat(64)]);
    const detail = await call("GET", `/api/mcp-keys/${created.key.id}`, "nhanvien");
    assert.deepEqual(detail.body.data.recent_calls.map((row: { tool: string; row_count: number }) => [row.tool, row.row_count]), [["query_records", 3]]);
    assert.ok(!/args_hash|args_preview/.test(detail.raw));
  });
});
