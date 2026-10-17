import assert from "node:assert/strict";
import { test } from "node:test";
import { McpCallStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { admin } from "../data-access/data-access-test-support.js";
import { ConcurrencyGate } from "./mcp-concurrency-gate.js";
import { connectTestClient } from "./mcp-test-support.js";

const textOf = (result: { content?: unknown }) => ((result.content as { text: string }[])[0]).text;
const GROUPS_QUERY = { name: "query_records", arguments: { entity: "groups", fields: ["id", "name"], page: { size: 3 } } };

test("lỗi hệ thống (mysql2 ném SQL + tham số) → «Lỗi máy chủ» chung, SQL không lọt ra client, nhật ký Error/internal", async () => {
  const secretSql = "SELECT zalo_group.secret_col FROM zalo_group WHERE name = 'bí mật' AND token = ?";
  const db = { query: async () => { throw Object.assign(new Error(`ER_BAD_FIELD_ERROR: Unknown column in ${secretSql}`), { sql: secretSql, sqlMessage: secretSql, code: "ER_BAD_FIELD_ERROR" }); } } as unknown as Db;
  const rig = await connectTestClient(admin(), { db });
  try {
    const result = await rig.client.callTool(GROUPS_QUERY);
    assert.equal(result.isError, true);
    const everything = JSON.stringify(result);
    assert.match(textOf(result), /Lỗi máy chủ/);
    for (const leak of ["SELECT", "secret_col", "zalo_group", "ER_BAD_FIELD_ERROR", "bí mật"]) assert.ok(!everything.includes(leak), `lộ «${leak}»`);
    assert.deepEqual(rig.logs.map((entry) => [entry.status, entry.errorCode]), [[McpCallStatus.Error, "internal"]]);
    assert.ok(!JSON.stringify(rig.logs).includes("SELECT"), "nhật ký chỉ lưu mã ngắn, không lưu câu SQL");
  } finally {
    await rig.close();
  }
});

test("cổng đồng thời toàn cục đầy quá hạn chờ → isError server_busy, nhật ký RateLimited; lời gọi đầu vẫn hoàn tất", async () => {
  let unblock: () => void = () => {};
  const blocker = new Promise<void>((resolve) => { unblock = resolve; });
  const db = { query: async () => { await blocker; return [[], []]; } } as unknown as Db;
  const rig = await connectTestClient(admin(), { db, gate: new ConcurrencyGate(1, 30) });
  try {
    const first = rig.client.callTool(GROUPS_QUERY);
    await new Promise((resolve) => setTimeout(resolve, 20)); // để lời gọi đầu chiếm chỗ
    const second = await rig.client.callTool(GROUPS_QUERY);
    assert.equal(second.isError, true);
    assert.match(textOf(second), /server_busy/);
    unblock();
    assert.ok(!(await first).isError);
    assert.deepEqual(rig.logs.map((entry) => [entry.status, entry.errorCode ?? null]), [[McpCallStatus.RateLimited, "server_busy"], [McpCallStatus.Ok, null]]);
  } finally {
    unblock();
    await rig.close();
  }
});

test("chỗ chạy được trả lại sau lời gọi lỗi: lời gọi kế tiếp vẫn chạy được", async () => {
  const db = { query: async () => { throw new Error("hỏng DB"); } } as unknown as Db;
  const rig = await connectTestClient(admin(), { db, gate: new ConcurrencyGate(1, 30) });
  try {
    for (let index = 0; index < 3; index++) assert.match(textOf(await rig.client.callTool(GROUPS_QUERY)), /Lỗi máy chủ/);
    assert.ok(rig.logs.every((entry) => entry.errorCode === "internal"));
  } finally {
    await rig.close();
  }
});
