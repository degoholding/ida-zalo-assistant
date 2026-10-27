// 27/10/2026 — lọc theo tài khoản Zalo qua MCP (query_records account_id) trên MySQL THẬT: nhóm theo bot_group còn ở (rời nhóm thì
// không tính), cuộc riêng theo owner_bot_id; cùng hàm SQL với màn Hội thoại web; whoami liệt kê tài khoản để biết id.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test_a4 node --import tsx --test test/mcp-account-filter.integration.test.ts

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SYSTEM_PRINCIPAL } from "../src/auth/principal.js";
import { BotAccountKind, McpCallSource } from "../src/constants.js";
import { buildDataAccessContext } from "../src/data-access/data-access-context.js";
import { findTool } from "../src/data-access/read-tool-catalog.js";
import { runTool } from "../src/data-access/tool-runner.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe("MCP lọc theo tài khoản Zalo (MySQL thật)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  const ids: Record<string, number> = {};
  const insertId = async (sql: string, params: unknown[]) => Number((await db.query<any>(sql, params))[0].insertId);

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of ["attachment", "message", "bot_group", "zalo_group", "bot_account"]) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    ids.botA = await insertId("INSERT INTO bot_account (label, display_name, kind, is_active) VALUES ('tro-ly', 'Bot Trợ lý', ?, 1)", [BotAccountKind.Assistant]);
    ids.botB = await insertId("INSERT INTO bot_account (label, display_name, kind, is_active) VALUES ('nghe', 'Zalo sếp', ?, 1)", [BotAccountKind.Normal]);
    ids.groupA = await insertId("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages) VALUES (1, 'gA', 'Nhóm của A', 1)", []);
    ids.groupB = await insertId("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages) VALUES (1, 'gB', 'Nhóm của B', 1)", []);
    ids.groupLeft = await insertId("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages) VALUES (1, 'gL', 'Nhóm B đã rời', 1)", []);
    ids.directB = await insertId("INSERT INTO zalo_group (thread_type, zalo_group_id, owner_bot_id, name, read_messages) VALUES (0, 'u-khach', ?, 'Khách nhắn B', 1)", [ids.botB]);
    await db.query("INSERT INTO bot_group (bot_account_id, group_id) VALUES (?, ?), (?, ?), (?, ?)", [ids.botA, ids.groupA, ids.botB, ids.groupB, ids.botB, ids.groupLeft]);
    await db.query("UPDATE bot_group SET left_at = NOW(3) WHERE group_id = ?", [ids.groupLeft]);
    for (const [key, group] of [["mA", ids.groupA], ["mB", ids.groupB], ["mL", ids.groupLeft], ["mD", ids.directB]] as const) {
      ids[key] = await insertId("INSERT INTO message (group_id, zalo_msg_id, kind, sender_uid, sender_name, sent_at, text) VALUES (?, ?, 0, 'u1', 'Người gửi', NOW(3), ?)", [group, key, `tin ${key}`]);
    }
    ids.fileB = await insertId("INSERT INTO attachment (message_id, group_id, file_name, file_ext, source_url, status) VALUES (?, ?, 'b.pdf', 'pdf', 'https://f', 3)", [ids.mB, ids.groupB]);
  });
  after(async () => { await db?.end(); });

  const ctx = () => buildDataAccessContext({ db, principal: SYSTEM_PRINCIPAL, maskPersonal: false, source: McpCallSource.Http });
  const query = async (entity: string, filters: unknown[], extra: Record<string, unknown> = {}) => {
    const result = await runTool(findTool("query_records")!, ctx(), { entity, fields: ["id"], filters, ...extra });
    assert.ok(!result.isError, result.text);
    return (result.structured as { items: { id: number }[] }).items.map((item) => item.id).sort((a, b) => a - b);
  };

  test("groups / conversations / messages / files lọc theo account_id: nhóm còn ở + cuộc riêng của tài khoản; nhóm đã rời không tính", async () => {
    assert.deepEqual(await query("groups", [{ field: "account_id", op: "eq", value: ids.botB }]), [ids.groupB]);
    assert.deepEqual(await query("conversations", [{ field: "account_id", op: "eq", value: ids.botB }]), [ids.directB]);
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const until = new Date(Date.now() + 86_400_000).toISOString();
    const dayRange = [{ field: "sent_at", op: "gte", value: since }, { field: "sent_at", op: "lt", value: until }];
    assert.deepEqual(await query("messages", [...dayRange, { field: "account_id", op: "eq", value: ids.botB }]), [ids.mB, ids.mD].sort((a, b) => a - b));
    assert.deepEqual(await query("messages", [...dayRange, { field: "account_id", op: "in", value: [ids.botA, ids.botB] }]), [ids.mA, ids.mB, ids.mD].sort((a, b) => a - b));
    assert.deepEqual(await query("messages", [...dayRange, { field: "account_id", op: "ne", value: ids.botB }]), [ids.mA, ids.mL].sort((a, b) => a - b));
    assert.deepEqual(await query("files", [{ field: "account_id", op: "eq", value: ids.botB }]), [ids.fileB]);
    assert.deepEqual(await query("files", [{ field: "account_id", op: "eq", value: ids.botA }]), []);
  });

  test("whoami liệt kê tài khoản Zalo (id, tên, loại) để AI biết id lọc", async () => {
    const result = await runTool(findTool("whoami")!, ctx(), {});
    const accounts = (result.structured as { zalo_accounts: { id: number; name: string; kind_label: string }[] }).zalo_accounts;
    assert.deepEqual(accounts.map((account) => [account.id, account.name, account.kind_label]).sort(),
      [[ids.botA, "Bot Trợ lý", "Trợ lý"], [ids.botB, "Zalo sếp", "Chỉ thu thập"]].sort());
  });
});
