// Phase 9 — cổng /mcp đầu-cuối trên MySQL THẬT: khóa tạo bằng kho khóa thật → máy chủ HTTP thật (cổng ngẫu nhiên, createMcpGateway)
// → Client SDK qua mạng: tools/list theo vai trò + mức khóa, tools/call, dòng mcp_call_log, khóa thu hồi / hết hạn / chủ bị tắt → 401,
// Origin lạ → 403, quá nhịp → rate_limited, nhóm Mật cần CẢ cờ người dùng lẫn cờ khóa.
//
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_p9 npm test

import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { RowDataPacket } from "mysql2";
import { createMcpKey, revokeMcpKey } from "../src/auth/mcp-api-key-store.js";
import type { AppConfig } from "../src/config.js";
import { McpAccessLevel, McpCallStatus, UserRole } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { createMcpGateway, type McpGateway } from "../src/mcp/mcp-http-handler.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["mcp_call_log", "audit_log", "message", "zalo_group", "user_group_scope", "app_user"];
const RATE_LIMIT = 3;

const config = {
  mcp: { enabled: true, allowedHosts: ["127.0.0.1"], rateLimitPerMinute: RATE_LIMIT, maxConcurrentPerKey: 4, maxConcurrent: 3, queueWaitMs: 1000, badKeyLimitPerMinute: 1000 },
  privacy: { maskPersonalData: false },
} as unknown as AppConfig;

describe("cổng /mcp đầu-cuối (MySQL + HTTP thật)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let gateway: McpGateway;
  let server: http.Server;
  let url: string;
  const ids: Record<string, number> = {};
  const groups: Record<string, number> = {};

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    gateway = createMcpGateway(db, config);
    server = http.createServer((request, response) => { gateway.handle(request, response, "198.51.100.7").catch(() => response.destroy()); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  after(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await gateway?.close();
    await db?.end();
  });

  async function addUser(name: string, role: UserRole, confidential = false): Promise<void> {
    const [result] = await db.query<any>("INSERT INTO app_user (username, email, full_name, role, all_groups, can_view_confidential, is_active) VALUES (?, ?, ?, ?, 1, ?, 1)",
      [name, `${name}@ida.vn`, name, role, confidential ? 1 : 0]);
    ids[name] = Number(result.insertId);
  }
  const newKey = async (user: string, level = McpAccessLevel.Read, includeConfidential = false, days: number | null = 30) =>
    (await createMcpKey(db, { userId: ids[user], name: `khóa ${user}`, accessLevel: level, days, includeConfidential })).token;

  async function connect(token: string): Promise<Client> {
    const client = new Client({ name: "gateway-it", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return client;
  }
  const toolNames = async (client: Client) => (await client.listTools()).tools.map((tool) => tool.name);
  const rawPost = (token: string | null, headers: Record<string, string> = {}) => fetch(url, {
    method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  });
  /** `mcp_call_log` ghi không chờ (fire-and-forget) nên thăm dò tới khi đủ dòng — hạn 2 giây. */
  async function waitLogs(count: number): Promise<RowDataPacket[]> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const [rows] = await db.query<RowDataPacket[]>("SELECT source, tool, key_id, user_id, status, entity, error_code FROM mcp_call_log ORDER BY id");
      if (rows.length >= count) return rows;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`chưa đủ ${count} dòng mcp_call_log`);
  }

  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    // DELETE (không TRUNCATE) để id khóa KHÔNG quay về 1: bộ giới hạn nhịp của cổng nhớ theo id khóa suốt đời tiến trình
    await db.query("DELETE FROM mcp_api_key");
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    await addUser("quanly", UserRole.Manager, true);
    await addUser("nhanvien", UserRole.Staff);
    for (const [key, secret] of [["thuong", 0], ["mat", 1]] as const) {
      const [group] = await db.query<any>("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages, is_confidential) VALUES (1, ?, ?, 1, ?)", [`gw-${key}`, `Nhóm ${key}`, secret]);
      groups[key] = group.insertId;
    }
  });

  test("tools/list theo vai trò + mức khóa; tools/call chạy thật và có dòng mcp_call_log", async () => {
    const readOnly = await connect(await newKey("quanly"));
    const readWrite = await connect(await newKey("quanly", McpAccessLevel.ReadWrite));
    try {
      const names = await toolNames(readOnly);
      assert.ok(names.includes("query_records") && names.includes("describe_entities"));
      assert.ok(names.every((name) => !/^propose_|^confirm_write$/.test(name)), "khóa chỉ đọc không thấy công cụ ghi");
      assert.ok((await toolNames(readWrite)).some((name) => name.startsWith("propose_")));
      const result = await readOnly.callTool({ name: "query_records", arguments: { entity: "groups", fields: ["id", "name"], filters: [{ field: "name", op: "contains", value: "Nhóm " }] } });
      assert.ok(!result.isError, JSON.stringify(result));
      const items = (result.structuredContent as { items: { id: number }[] }).items;
      assert.deepEqual(items.map((item) => item.id), [groups.thuong], "khóa không cờ Mật không thấy nhóm Mật dù chủ khóa có cờ");
      const [log] = await waitLogs(1);
      assert.equal(log.tool, "query_records");
      assert.equal(log.entity, "groups");
      assert.equal(Number(log.status), McpCallStatus.Ok);
      assert.equal(Number(log.user_id), ids.quanly);
      assert.notEqual(log.key_id, null);
    } finally {
      await Promise.all([readOnly.close(), readWrite.close()]);
    }
  });

  test("nhóm Mật cần CẢ cờ người dùng lẫn cờ khóa", async () => {
    const find = async (token: string) => {
      const client = await connect(token);
      try {
        const result = await client.callTool({ name: "query_records", arguments: { entity: "groups", fields: ["id"], filters: [{ field: "name", op: "contains", value: "Nhóm " }] } });
        return (result.structuredContent as { items: { id: number }[] }).items.map((item) => item.id).sort();
      } finally { await client.close(); }
    };
    assert.deepEqual(await find(await newKey("quanly", McpAccessLevel.Read, true)), [groups.thuong, groups.mat].sort());
    assert.deepEqual(await find(await newKey("quanly", McpAccessLevel.Read, false)), [groups.thuong]);
    assert.deepEqual(await find(await newKey("nhanvien", McpAccessLevel.Read, true)), [groups.thuong], "người dùng không có cờ Mật, khóa có cờ cũng không đủ");
  });

  test("Nhân viên: khóa đọc+ghi bị chặn trần về chỉ đọc (không thấy công cụ ghi)", async () => {
    await db.query("UPDATE app_user SET role = ? WHERE id = ?", [UserRole.Manager, ids.nhanvien]);
    const token = await newKey("nhanvien", McpAccessLevel.ReadWrite);
    await db.query("UPDATE app_user SET role = ? WHERE id = ?", [UserRole.Staff, ids.nhanvien]);
    const client = await connect(token);
    try {
      assert.ok((await toolNames(client)).every((name) => !/^propose_|^confirm_write$/.test(name)));
    } finally { await client.close(); }
  });

  test("khóa thu hồi / hết hạn / chủ bị tắt / không có khóa → 401; Origin lạ → 403", async () => {
    const revoked = await newKey("quanly");
    const expired = await newKey("quanly");
    const ownerOff = await newKey("nhanvien");
    const good = await newKey("quanly");
    assert.equal((await rawPost(good)).status, 200);
    const [rows] = await db.query<RowDataPacket[]>("SELECT id, name FROM mcp_api_key ORDER BY id");
    assert.equal(rows.length, 4);
    await revokeMcpKey(db, Number(rows[0].id), "test");
    await db.query("UPDATE mcp_api_key SET expires_at = NOW(3) - INTERVAL 1 MINUTE WHERE id = ?", [rows[1].id]);
    await db.query("UPDATE app_user SET is_active = 0 WHERE id = ?", [ids.nhanvien]);
    for (const token of [revoked, expired, ownerOff]) assert.equal((await rawPost(token)).status, 401);
    assert.equal((await rawPost(null)).status, 401);
    assert.equal((await rawPost(good)).status, 200, "khóa còn tốt vẫn dùng được");
    assert.equal((await rawPost(good, { Origin: "https://evil.example.org" })).status, 403);
  });

  test(`quá nhịp: lời gọi thứ ${RATE_LIMIT + 1} trong phút → rate_limited, ghi nhật ký trạng thái RateLimited; khóa khác không bị ảnh hưởng`, async () => {
    const client = await connect(await newKey("quanly"));
    const other = await connect(await newKey("quanly"));
    try {
      const call = (who: Client) => who.callTool({ name: "describe_entities", arguments: {} });
      for (let index = 0; index < RATE_LIMIT; index += 1) assert.ok(!(await call(client)).isError);
      const limited = await call(client);
      assert.equal(limited.isError, true);
      assert.match(JSON.stringify(limited.content), /rate_limited/);
      assert.ok(!(await call(other)).isError, "khóa khác còn nhịp");
      const logs = await waitLogs(RATE_LIMIT + 2);
      assert.equal(logs.filter((row) => Number(row.status) === McpCallStatus.RateLimited).length, 1);
    } finally {
      await Promise.all([client.close(), other.close()]);
    }
  });
});
