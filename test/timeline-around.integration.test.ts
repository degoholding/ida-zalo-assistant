// Mở cuộc ĐÚNG CHỖ một tin cũ (màn Tệp «Xem trong hội thoại», 08/10/2026): GET /api/conversations/:id/messages?around=<id
// tin> trả nửa trang trước + nửa trang sau, rồi cuộn lên (before_id) / xuống (after_id) tiếp được. Chạy trên MySQL THẬT.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { ensureGroup } from "../src/sync/group-repository.js";
import { ingestGroupMessage } from "../src/sync/message-ingest.js";
import { listMessages } from "../src/web/api/conversations-api.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["attachment", "message", "group_member", "bot_group", "zalo_group", "contact", "bot_account"];
const START_MS = Date.parse("2026-09-01T00:00:00Z");
const TOTAL = 25;

interface Page { items: { id: number; text: string }[]; older_cursor: number | null; newer_cursor: number | null }

describe("dòng tin quanh một tin (around / after_id / before_id)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let threadId: number;
  let otherThreadId: number;
  const ids: number[] = [];

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => {
    await db?.end();
  });
  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    await db.query("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    const deps = { db, defaults: { readMessages: true, captureFiles: false } };
    // Tin 1..25, mỗi phút một tin; tin 13 và 14 CÙNG mili giây — kiểm thứ tự theo id khi trùng giờ
    for (let index = 1; index <= TOTAL; index += 1) {
      const sentAtMs = START_MS + (index === 14 ? 13 : index) * 60_000;
      await ingestGroupMessage(deps, 1, { zaloGroupId: "g-a", msgId: `m${index}`, cliMsgId: "", msgType: "webchat", senderUid: "u-lan",
        senderName: "Lan", sentAtMs, content: `tin ${index}`, quote: null, mentions: null });
    }
    await ingestGroupMessage(deps, 1, { zaloGroupId: "g-b", msgId: "x1", cliMsgId: "", msgType: "webchat", senderUid: "u-lan",
      senderName: "Lan", sentAtMs: START_MS, content: "nhóm khác", quote: null, mentions: null });
    const { group } = await ensureGroup(db, "g-a", deps.defaults);
    const { group: other } = await ensureGroup(db, "g-b", deps.defaults);
    threadId = group.id;
    otherThreadId = other.id;
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM message WHERE group_id = ? ORDER BY id", [threadId]);
    ids.length = 0;
    ids.push(...rows.map((row) => Number(row.id)));
  });

  const page = async (params: Record<string, string | number>) =>
    (await listMessages(db, threadId, new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])))) as unknown as Page;
  const texts = (result: Page) => result.items.map((item) => item.text);

  test("around an old message returns it in the middle, ordered by time, with id cursors both ways", async () => {
    const result = await page({ around: ids[9], limit: 6 }); // tin 10
    assert.deepEqual(texts(result), ["tin 8", "tin 9", "tin 10", "tin 11", "tin 12", "tin 13"]);
    assert.equal(result.older_cursor, ids[7]);
    assert.equal(result.newer_cursor, ids[12]);

    const older = await page({ before_id: result.older_cursor!, limit: 6 });
    assert.deepEqual(texts(older), ["tin 2", "tin 3", "tin 4", "tin 5", "tin 6", "tin 7"]);
    assert.equal(older.older_cursor, ids[1], "còn tin 1");
    // Mốc «mới hơn» là id tin: tin 13 và 14 trùng mili giây mà tin 14 vẫn không bị sót, không lặp tin 13
    const newer = await page({ after_id: result.newer_cursor!, limit: 6 });
    assert.deepEqual(texts(newer), ["tin 14", "tin 15", "tin 16", "tin 17", "tin 18", "tin 19"]);
    assert.equal(newer.newer_cursor, ids[18]);
    // Trang «mới hơn» dẫn ngược về trước được, trùng mili giây vẫn không sót tin 13 (giao diện nạp lại chuỗi trang từ
    // trang mới nhất lần về)
    assert.equal(newer.older_cursor, ids[13]);
    assert.deepEqual(texts(await page({ before_id: newer.older_cursor!, limit: 3 })), ["tin 11", "tin 12", "tin 13"]);
  });

  test("around a message sharing its timestamp with a neighbour keeps both, ordered by id", async () => {
    const result = await page({ around: ids[13], limit: 4 }); // tin 14 (cùng giờ tin 13)
    assert.deepEqual(texts(result), ["tin 13", "tin 14", "tin 15", "tin 16"]);
  });

  test("cursors say exactly whether more exists — a page that ends right at the edge has no cursor", async () => {
    const newest = await page({ around: ids[TOTAL - 1], limit: 6 });
    assert.equal(texts(newest).at(-1), `tin ${TOTAL}`);
    assert.equal(newest.newer_cursor, null);
    assert.ok(newest.older_cursor);
    const oldest = await page({ around: ids[0], limit: 6 });
    assert.equal(texts(oldest)[0], "tin 1");
    assert.equal(oldest.older_cursor, null);
    assert.ok(oldest.newer_cursor);
    // Tin 22 ở giữa: sau nó còn đúng 3 tin (23, 24, 25) = nửa trang → không còn gì nữa, không mời «xem tin mới hơn» rỗng
    assert.equal((await page({ around: ids[21], limit: 6 })).newer_cursor, null);
    // Đúng 25 tin, trang 25 → không còn tin cũ hơn
    assert.equal((await page({ limit: TOTAL })).older_cursor, null);
    assert.equal((await page({ limit: TOTAL - 1 })).older_cursor, ids[1]);
  });

  test("the latest page has no newer cursor and an after_id at the newest message is an empty page", async () => {
    const latest = await page({ limit: 5 });
    assert.equal(latest.newer_cursor, null);
    assert.deepEqual(texts(latest), ["tin 21", "tin 22", "tin 23", "tin 24", "tin 25"]);
    assert.equal(latest.older_cursor, ids[20]);
    const empty = await page({ after_id: ids[TOTAL - 1], limit: 5 });
    assert.deepEqual(empty.items, []);
    assert.equal(empty.newer_cursor, null);
  });

  test("the old millisecond before= cursor still works", async () => {
    const result = await page({ before: START_MS + 5 * 60_000, limit: 2 });
    assert.deepEqual(texts(result), ["tin 3", "tin 4"]);
  });

  test("a message id from another conversation, or one that does not exist, is a 404 — no leaking other threads", async () => {
    const [other] = await db.query<RowDataPacket[]>("SELECT id FROM message WHERE group_id = ?", [otherThreadId]);
    await assert.rejects(page({ around: Number(other[0].id) }), (error: { status?: number }) => error.status === 404);
    await assert.rejects(page({ after_id: Number(other[0].id) }), (error: { status?: number }) => error.status === 404);
    await assert.rejects(page({ before_id: Number(other[0].id) }), (error: { status?: number }) => error.status === 404);
    await assert.rejects(page({ around: 99_999_999 }), (error: { status?: number }) => error.status === 404);
  });

  test("garbage paging params fall back to the latest page instead of erroring", async () => {
    for (const params of [{ around: "abc" }, { around: -5 }, { after_id: "x" }, { before_id: "0" }, { before: "1e999" }, { limit: -1 }]) {
      const result = await page(params as Record<string, string | number>);
      assert.equal(texts(result).at(-1), `tin ${TOTAL}`, JSON.stringify(params));
    }
  });
});
