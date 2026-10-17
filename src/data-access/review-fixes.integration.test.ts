// Hồi quy các lỗi của review phase 2 trên MySQL THẬT (phân trang H1 / L4, kênh phụ nhóm M1, cuộc riêng của mình H2 / L7,
// tin thu hồi L3). Chỉ chạy khi có TEST_DATABASE_URL (DB thử, KHÔNG dùng DB dev); dữ liệu có tiền tố `da-it-` và tự dọn.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { runMigrations } from "../db/migrate.js";
import { createPool, type Db } from "../db/pool.js";
import { admin, makeCtx, staff } from "./data-access-test-support.js";
import { findTool } from "./read-tool-catalog.js";
import { runTool } from "./tool-runner.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const PREFIX = "da-it-";

describe("data-access review fixes (MySQL)", { skip: databaseUrl ? false : "cần TEST_DATABASE_URL" }, () => {
  let db: Db;
  let threadId = 0;
  let allIds: number[] = [];

  async function insertGroup(suffix: string, overrides: { threadType?: number; confidential?: number; readMessages?: number } = {}): Promise<number> {
    const [result] = await db.query<any>(
      "INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages, is_confidential) VALUES (?, ?, ?, ?, ?)",
      [overrides.threadType ?? 1, `${PREFIX}${suffix}`, `Nhóm ${suffix}`, overrides.readMessages ?? 1, overrides.confidential ?? 0]);
    return result.insertId as number;
  }

  async function insertMessage(group: number, sentAt: string, key: string, recalled = false): Promise<number> {
    const [result] = await db.query<any>(
      "INSERT INTO message (group_id, zalo_msg_id, kind, sender_uid, sender_name, sent_at, text, recalled_at) VALUES (?, ?, 0, 'u1', 'A', ?, ?, ?)",
      [group, `${PREFIX}${key}`, sentAt, `tin ${key}`, recalled ? sentAt : null]);
    return result.insertId as number;
  }

  async function cleanup(): Promise<void> {
    await db.query("DELETE FROM zalo_group WHERE zalo_group_id LIKE ?", [`${PREFIX}%`]);
    await db.query("DELETE FROM contact WHERE zalo_uid LIKE ?", [`${PREFIX}%`]);
  }

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    await cleanup();
    threadId = await insertGroup("paging");
    // 12 tin gốc (id tăng, giờ tăng), rồi 5 tin «lấy tin cũ» chèn SAU (id lớn hơn nhưng giờ gửi SỚM hơn), và 6 tin trùng một mili giây
    for (let i = 0; i < 12; i++) allIds.push(await insertMessage(threadId, `2026-10-10 10:${String(10 + i).padStart(2, "0")}:00.000`, `m${i}`));
    for (let i = 0; i < 5; i++) allIds.push(await insertMessage(threadId, `2026-10-10 10:0${i}:00.000`, `old${i}`));
    for (let i = 0; i < 6; i++) allIds.push(await insertMessage(threadId, "2026-10-10 11:00:00.000", `tie${i}`));
  });

  after(async () => {
    if (db) {
      await cleanup();
      await db.end();
    }
  });

  const thread = (ctx = makeCtx(admin(), {}, db), input: Record<string, unknown> = {}) =>
    runTool(findTool("get_thread_messages")!, ctx, { thread_id: threadId, ...input });

  async function expectedOrder(): Promise<number[]> {
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM message WHERE group_id = ? ORDER BY sent_at, id", [threadId]);
    return rows.map((row) => Number(row.id));
  }

  test("H1: đọc lùi theo next.before_message_id thấy ĐỦ mọi tin, không trùng, đúng thứ tự (id không đơn điệu theo giờ)", async () => {
    const pages: number[][] = [];
    let cursor: number | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const result = await thread(makeCtx(admin(), {}, db), { limit: 4, ...(cursor ? { before_message_id: cursor } : {}) });
      assert.equal(result.isError, false, result.text);
      const out = result.structured as { items: { id: number }[]; next: { before_message_id?: number } | null };
      pages.unshift(out.items.map((item) => item.id));
      if (!out.next) break;
      cursor = out.next.before_message_id;
    }
    assert.deepEqual(pages.flat(), await expectedOrder());
  });

  test("H1 + L4: đọc xuôi theo next.after_message_id đủ tin kể cả khi > limit tin trùng mili giây", async () => {
    const seen: number[] = [];
    let cursor: number | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const result = await thread(makeCtx(admin(), {}, db), { limit: 4, from: "2026-10-10", ...(cursor ? { after_message_id: cursor } : {}) });
      assert.equal(result.isError, false, result.text);
      const out = result.structured as { items: { id: number }[]; next: { after_message_id?: number } | null };
      seen.push(...out.items.map((item) => item.id));
      if (!out.next) break;
      cursor = out.next.after_message_id;
    }
    assert.deepEqual(seen, await expectedOrder());
  });

  test("mốc phân trang của cuộc khác bị từ chối (invalid_value)", async () => {
    const other = await insertGroup("other");
    const foreign = await insertMessage(other, "2026-10-10 12:00:00.000", "foreign");
    const result = await thread(makeCtx(admin(), {}, db), { before_message_id: foreign });
    assert.equal(result.errorCode, "invalid_value");
  });

  test("M1: lọc contacts.group_id không dò được thành viên nhóm ngoài phạm vi / nhóm Mật; group_count chỉ đếm nhóm thấy được", async () => {
    const visible = await insertGroup("vis");
    const secret = await insertGroup("secret", { confidential: 1 });
    const outside = await insertGroup("outside");
    await db.query("INSERT INTO contact (zalo_uid, display_name) VALUES (?, 'Người A')", [`${PREFIX}a`]);
    for (const group of [visible, secret, outside]) await db.query("INSERT INTO group_member (group_id, zalo_uid) VALUES (?, ?)", [group, `${PREFIX}a`]);
    const query = (ctx: ReturnType<typeof makeCtx>, groupId: number) => runTool(findTool("query_records")!, ctx, {
      entity: "contacts", fields: ["zalo_uid", "group_count"], filters: [{ field: "group_id", op: "eq", value: groupId }, { field: "zalo_uid", op: "contains", value: PREFIX }],
    });
    const scoped = makeCtx(staff({ groupIds: [visible, secret] }), {}, db);
    const items = async (ctx: ReturnType<typeof makeCtx>, groupId: number) => ((await query(ctx, groupId)).structured as { items: { zalo_uid: string; group_count: number }[] }).items;
    assert.equal((await items(scoped, outside)).length, 0, "nhóm ngoài phạm vi");
    assert.equal((await items(scoped, secret)).length, 0, "nhóm Mật khi không có cờ Mật");
    const seen = await items(scoped, visible);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].group_count, 1, "chỉ đếm nhóm trong phạm vi và không Mật");
    const allMat = makeCtx(admin({ canViewConfidential: true }), {}, db);
    assert.equal((await items(allMat, secret)).length, 1);
    assert.equal((await items(allMat, secret))[0].group_count, 3);
  });

  test("H2 / L7: ownDirectThreadsOnly — chỉ thấy cuộc riêng của chính mình, cuộc riêng của người khác not_found", async () => {
    const mine = await insertGroup("dm-me", { threadType: 0, readMessages: 0 });
    const theirs = await insertGroup("dm-other", { threadType: 0, readMessages: 1 });
    await insertMessage(mine, "2026-10-10 09:00:00.000", "dm-mine");
    await insertMessage(theirs, "2026-10-10 09:00:00.000", "dm-theirs");
    const everyone = makeCtx(admin(), {}, db);
    const own = makeCtx(admin(), { ownDirectThreadsOnly: true, ownDirectUid: `${PREFIX}dm-me` }, db);
    assert.equal((await thread(everyone, { thread_id: theirs })).isError, false, "luật web: người «mọi nhóm» thấy mọi cuộc riêng");
    assert.equal((await runTool(findTool("get_thread_messages")!, own, { thread_id: mine })).isError, false);
    assert.equal((await runTool(findTool("get_thread_messages")!, own, { thread_id: theirs })).errorCode, "not_found");
    const noUid = makeCtx(admin(), { ownDirectThreadsOnly: true, ownDirectUid: null }, db);
    assert.equal((await runTool(findTool("get_thread_messages")!, noUid, { thread_id: mine })).errorCode, "not_found");
    const listed = await runTool(findTool("query_records")!, own, { entity: "conversations", fields: ["id"], search: "Nhóm dm-" });
    assert.deepEqual((listed.structured as { items: { id: number }[] }).items.map((item) => item.id), [mine]);
  });

  test("L3: tệp của tin đã thu hồi không đọc được và không liệt kê", async () => {
    const group = await insertGroup("recalled");
    const live = await insertMessage(group, "2026-10-10 09:00:00.000", "file-live");
    const gone = await insertMessage(group, "2026-10-10 09:01:00.000", "file-gone", true);
    const attach = async (messageId: number) => {
      const [result] = await db.query<any>("INSERT INTO attachment (message_id, group_id, file_name, source_url, status) VALUES (?, ?, 'a.pdf', 'x', 1)", [messageId, group]);
      return result.insertId as number;
    };
    const liveFile = await attach(live);
    const goneFile = await attach(gone);
    const ctx = makeCtx(admin(), {}, db);
    assert.equal((await runTool(findTool("get_file_text")!, ctx, { attachment_id: liveFile })).isError, false);
    assert.equal((await runTool(findTool("get_file_text")!, ctx, { attachment_id: goneFile })).errorCode, "not_found");
    const listed = await runTool(findTool("query_records")!, ctx, { entity: "files", fields: ["id"], filters: [{ field: "group_id", op: "eq", value: group }] });
    assert.deepEqual((listed.structured as { items: { id: number }[] }).items.map((item) => item.id), [liveFile]);
  });
});
