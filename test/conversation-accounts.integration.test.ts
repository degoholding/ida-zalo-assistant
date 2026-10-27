import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { listConversations, getConversation } from "../src/web/api/conversations-api.js";
import { listAccountOptions } from "../src/web/api/conversation-accounts.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";

// Hội thoại theo tài khoản Zalo (27/10/2026) chạy SQL THẬT: bộ lọc account_id (nhóm qua bot_group còn ở, cuộc riêng qua
// owner_bot_id) + nhãn accounts trên từng cuộc. Tự bỏ qua nếu thiếu TEST_DATABASE_URL.

const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = !databaseUrl && "chưa đặt TEST_DATABASE_URL";
let db: Db;

before(async () => {
  if (!databaseUrl) return;
  await runMigrations(databaseUrl);
  db = createPool(databaseUrl);
  for (const table of ["attachment", "message", "group_member", "bot_group", "zalo_group", "session_event", "bot_account"]) {
    await db.query(`DELETE FROM ${table}`).catch(() => undefined);
  }
  await db.query(`INSERT INTO bot_account (id, label, display_name, zalo_uid, kind, is_active, status) VALUES
    (1, 'tl', 'Lạc Lạc', 'u-bot-1', 0, 1, 1), (2, 'kho', 'Bot kho', 'u-bot-2', 1, 1, 1), (3, 'cu', '', 'u-bot-3', 1, 0, 0)`);
  // 100 nhóm có cả bot 1 lẫn 2; 101 chỉ bot 2; 102 bot 1 đã RỜI; 200 / 201 cuộc riêng của bot 1 / bot 2.
  // owner_bot_id của NHÓM để 1 (bot gặp nhóm đầu tiên) — nhóm 101 không được khớp bot 1 chỉ vì cột này
  await db.query(`INSERT INTO zalo_group (id, zalo_group_id, name, thread_type, read_messages, owner_bot_id, message_count) VALUES
    (100, 'g100', 'Nhóm chung', 1, 1, 1, 0), (101, 'g101', 'Nhóm kho', 1, 1, 1, 0), (102, 'g102', 'Nhóm đã rời', 1, 1, 1, 0),
    (200, 'c200', 'Anh A', 0, 1, 1, 0), (201, 'c201', 'Chị B', 0, 1, 2, 0)`);
  await db.query(`INSERT INTO bot_group (bot_account_id, group_id, joined_at, left_at) VALUES
    (1, 100, NOW(), NULL), (2, 100, NOW(), NULL), (2, 101, NOW(), NULL), (1, 102, NOW(), NOW())`);
});

after(async () => { await db?.end(); });

const ids = (result: { items: unknown[] }) => (result.items as RowDataPacket[]).map((row) => Number(row.id)).sort((a, b) => a - b);

test("lọc account_id: một tài khoản / nhiều tài khoản; nhóm đã rời không tính", { skip }, async () => {
  assert.deepEqual(ids(await listConversations(db, new URLSearchParams("account_id=1&page_size=50"))), [100, 200]);
  assert.deepEqual(ids(await listConversations(db, new URLSearchParams("account_id=2&page_size=50"))), [100, 101, 201]);
  assert.deepEqual(ids(await listConversations(db, new URLSearchParams("account_id__in=1,2&page_size=50"))), [100, 101, 200, 201]);
  assert.deepEqual(ids(await listConversations(db, new URLSearchParams("page_size=50"))), [100, 101, 102, 200, 201], "không lọc = tất cả");
  assert.equal((await listConversations(db, new URLSearchParams("account_id=1&page_size=50"))).total, 2, "đếm tổng cùng điều kiện");
});

test("mỗi cuộc trả accounts [{id, name, kind, kind_label}] — nhóm nhiều tài khoản, cuộc riêng một", { skip }, async () => {
  const result = await listConversations(db, new URLSearchParams("page_size=50"));
  const byId = new Map((result.items as RowDataPacket[]).map((row) => [Number(row.id), row.accounts]));
  assert.deepEqual(byId.get(100), [
    { id: 1, name: "Lạc Lạc", kind: 0, kind_label: "Trợ lý" },
    { id: 2, name: "Bot kho", kind: 1, kind_label: "Chỉ thu thập" },
  ]);
  assert.deepEqual(byId.get(102), [], "nhóm mà bot đã rời: không gắn tài khoản");
  assert.deepEqual(byId.get(201), [{ id: 2, name: "Bot kho", kind: 1, kind_label: "Chỉ thu thập" }]);

  const detail = await getConversation(db, 100);
  assert.equal((detail.accounts as unknown[]).length, 2, "cột hồ sơ phải nhận đủ tài khoản");
});

test("ô lọc Tài khoản: mọi tài khoản (đang dùng trước), tên rỗng lấy nhãn", { skip }, async () => {
  const options = await listAccountOptions(db);
  assert.deepEqual(options.map((option) => [option.id, option.name, option.kind_label]), [
    [1, "Lạc Lạc", "Trợ lý"], [2, "Bot kho", "Chỉ thu thập"], [3, "cu", "Chỉ thu thập"],
  ]);
});
