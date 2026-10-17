// Phase 7 — công cụ lõi (query_records / describe_entities) trong trợ lý, trên MySQL THẬT. Chạy qua `runTool` của trợ lý với ngữ cảnh
// do `resolveAskerAccess` dựng thật: số đếm khớp SQL tay, phạm vi nhóm + nhóm Mật theo người hỏi, hỏi trong nhóm bị khóa nhóm đó,
// có dòng mcp_call_log nguồn Assistant.
//
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_p7 npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { resolveAskerAccess } from "../src/assistant/asker-access.js";
import { runTool, type ToolContext } from "../src/assistant/tools.js";
import { ContactRole, McpCallSource, UserRole } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import { ensureGroup, updateGroupSettings } from "../src/sync/group-repository.js";
import { ingestGroupMessage, type IncomingGroupMessage } from "../src/sync/message-ingest.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["mcp_call_log", "assistant_turn", "attachment_text", "attachment", "message_search", "message", "group_member", "bot_group", "zalo_group",
  "contact", "company", "session_event", "bot_account", "user_group_scope", "app_user", "recipient_group", "recipient"];
const NOW = new Date("2026-10-01T05:00:00Z");
const FROM = "2026-09-30";
const TO = "2026-10-01";

function incoming(overrides: Partial<IncomingGroupMessage>): IncomingGroupMessage {
  return { zaloGroupId: "g-1", msgId: "1", cliMsgId: "", msgType: "webchat", senderUid: "u-x", senderName: "X", sentAtMs: NOW.getTime() - 3_600_000,
    content: "", quote: null, mentions: null, ...overrides };
}

describe("trợ lý + công cụ lõi query_records / describe_entities", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  const ids: Record<string, number> = {};

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => {
    await db?.end();
  });

  async function webUser(uid: string, options: { groups?: number[]; allGroups?: boolean; confidential?: boolean }): Promise<void> {
    await db.query("INSERT IGNORE INTO contact (zalo_uid, display_name) VALUES (?, ?)", [uid, uid]);
    const [contact] = await db.query<RowDataPacket[]>("SELECT id FROM contact WHERE zalo_uid = ?", [uid]);
    const [result] = await db.query<any>(
      "INSERT INTO app_user (email, username, full_name, role, contact_id, all_groups, can_view_confidential, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
      [`${uid}@ida.vn`, uid, uid, UserRole.Manager, contact[0].id, options.allGroups ? 1 : 0, options.confidential ? 1 : 0]);
    for (const groupId of options.groups ?? []) await db.query("INSERT INTO user_group_scope (user_id, group_id) VALUES (?, ?)", [result.insertId, groupId]);
  }

  async function ask(uid: string, groupScopeId?: number): Promise<ToolContext> {
    await db.query("INSERT IGNORE INTO contact (zalo_uid, display_name) VALUES (?, ?)", [uid, uid]);
    await db.query("UPDATE contact SET role = ? WHERE zalo_uid = ? AND role = ?", [ContactRole.Manager, uid, ContactRole.None]);
    const contact = (await findContactByUid(db, uid))!;
    const access = await resolveAskerAccess(db, contact, { groupScopeId, maskPersonal: false, now: NOW });
    return { db, askerUid: uid, access, filesToSend: [], now: NOW, scopeGroupId: groupScopeId, coreQueryTools: true };
  }

  const countWhere = async (sql: string, params: unknown[] = []) => {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM message m WHERE ${sql}`, params);
    return Number(rows[0].n);
  };

  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    const [bot] = await db.query<any>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    const deps = { db, defaults: { readMessages: true, captureFiles: false } };
    for (const [key, zaloId] of [["g1", "g-1"], ["g2", "g-2"], ["gm", "g-mat"]] as const) {
      const { group } = await ensureGroup(db, zaloId, { readMessages: true, captureFiles: false });
      ids[key] = group.id;
      await db.query("UPDATE zalo_group SET name = ? WHERE id = ?", [`Nhóm ${key}`, group.id]);
    }
    await updateGroupSettings(db, ids.gm, { isConfidential: true });
    let n = 0;
    const send = (zaloGroupId: string, count: number) => (async () => {
      for (let i = 0; i < count; i += 1) await ingestGroupMessage(deps, bot.insertId, incoming({ zaloGroupId, msgId: `${zaloGroupId}-${n += 1}`, content: `tin ${zaloGroupId} ${i}`, sentAtMs: NOW.getTime() - (i + 1) * 60_000 }));
    })();
    await send("g-1", 3);
    await send("g-2", 2);
    await send("g-mat", 4);
  });

  test("đếm tin theo nhóm (aggregate) khớp SQL tay; có dòng mcp_call_log nguồn Assistant", async () => {
    await webUser("u-all", { allGroups: true });
    const asker = await ask("u-all");
    const result = await runTool(asker, "query_records", {
      entity: "messages",
      filters: [{ field: "sent_at", op: "between", values: [FROM, TO] }],
      aggregate: { fn: "count", group_by: [{ field: "thread_id" }] },
    }) as any;
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    const byThread = Object.fromEntries(result.groups.map((row: any) => [row.thread_id, row.count]));
    assert.equal(byThread[ids.g1], await countWhere("m.group_id = ?", [ids.g1]));
    assert.equal(byThread[ids.g2], await countWhere("m.group_id = ?", [ids.g2]));
    assert.equal(byThread[ids.gm], undefined, "nhóm Mật không lộ khi chưa có cờ");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [logs] = await db.query<RowDataPacket[]>("SELECT source, tool, key_id, user_id, status, entity FROM mcp_call_log");
    assert.equal(logs.length, 1);
    assert.equal(Number(logs[0].source), McpCallSource.Assistant);
    assert.equal(logs[0].tool, "query_records");
    assert.equal(logs[0].key_id, null);
    assert.equal(logs[0].entity, "messages");
  });

  test("nhóm Mật theo cờ: có cờ thì đếm cả nhóm Mật", async () => {
    await webUser("u-flag", { allGroups: true, confidential: true });
    const result = await runTool(await ask("u-flag"), "query_records", {
      entity: "messages", filters: [{ field: "thread_id", op: "eq", value: String(ids.gm) }], aggregate: { fn: "count" },
    }) as any;
    assert.equal(result.groups[0].count, 4);
  });

  test("người bị khoanh nhóm: đọc thread ngoài phạm vi = 0 dòng; bộ lọc `in` bằng values ép kiểu số", async () => {
    await webUser("u-w", { groups: [ids.g1] });
    const asker = await ask("u-w");
    const out = await runTool(asker, "query_records", { entity: "messages", filters: [{ field: "thread_id", op: "in", values: [String(ids.g1), String(ids.g2)] }], aggregate: { fn: "count", group_by: [{ field: "thread_id" }] } }) as any;
    assert.deepEqual(out.groups.map((row: any) => row.thread_id), [ids.g1]);
    const groups = await runTool(asker, "query_records", { entity: "groups", fields: ["id"] }) as any;
    assert.deepEqual(groups.items.map((row: any) => row.id), [ids.g1]);
  });

  test("hỏi trong nhóm: chỉ nhóm đó, thực thể ngoài nhóm bị từ chối, id nhóm khác không lấy được", async () => {
    await webUser("u-all", { allGroups: true, confidential: true });
    const asker = await ask("u-all", ids.g1);
    const own = await runTool(asker, "query_records", { entity: "messages", filters: [{ field: "sent_at", op: "between", values: [FROM, TO] }], aggregate: { fn: "count", group_by: [{ field: "thread_id" }] } }) as any;
    assert.deepEqual(own.groups.map((row: any) => row.thread_id), [ids.g1]);
    const other = await runTool(asker, "query_records", { entity: "messages", filters: [{ field: "thread_id", op: "eq", value: String(ids.g2) }], aggregate: { fn: "count" } }) as any;
    assert.equal(other.groups?.[0]?.count ?? 0, 0);
    const groupRows = await runTool(asker, "query_records", { entity: "groups", fields: ["id"] }) as any;
    assert.deepEqual(groupRows.items.map((row: any) => row.id), [ids.g1]);
    for (const entity of ["contacts", "metrics", "tickets"]) assert.equal(((await runTool(asker, "query_records", { entity }) as any).error.code), "forbidden", entity);
    assert.equal(((await runTool(asker, "describe_entities", {}) as any).error.code), "forbidden");
  });

  test("describe_entities chỉ liệt kê thực thể người hỏi đọc được", async () => {
    await webUser("u-w", { groups: [ids.g1] });
    const described = await runTool(await ask("u-w"), "describe_entities", {}) as any;
    assert.ok(described.entities.some((entity: any) => entity.name === "messages"));
  });
});
