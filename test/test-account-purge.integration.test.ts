// 27/10/2026 — xóa TÀI KHOẢN THỬ kèm dữ liệu, trên MySQL THẬT + kho tệp đĩa tạm.
//   Tài khoản thật bị từ chối (không xóa gì); xem trước đúng số; xóa sạch cuộc riêng + nhóm chỉ có nó (tin, tệp trong kho, chữ
//   đã bóc); GIỮ nhóm có tài khoản khác (kể cả tài khoản khác đã rời) và cuộc riêng của tài khoản khác; việc giữ lại nhưng gỡ con
//   trỏ nguồn; việc nền chờ chạy vào cuộc đã xóa bị bỏ; gõ sai nhãn / chưa xác nhận sao lưu → 422; xóa tệp hỏng → storage_cleanup.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test_a2 node --import tsx --test test/test-account-purge.integration.test.ts

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { AttachmentStatus, ConversationType, JobKind, JobStatus } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { LocalFileStorage, type FileStorage } from "../src/storage/file-storage.js";
import { planTestAccountPurge, PurgeRefusedError, retryStorageCleanup } from "../src/sync/test-account-purge.js";
import { ApiError } from "../src/web/api/api-http.js";
import { purgeAccount } from "../src/web/api/accounts-api.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe("xóa tài khoản thử kèm dữ liệu (MySQL thật)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let rootDir = "";
  let storage: LocalFileStorage;
  const ids: Record<string, number> = {};
  const stopped: number[] = [];

  const count = async (sql: string, params: unknown[] = []) => Number((await db.query<RowDataPacket[]>(sql, params))[0][0].n);

  async function insertAccount(label: string, isTest: boolean): Promise<number> {
    const [result] = await db.query<ResultSetHeader>(
      "INSERT INTO bot_account (label, zalo_uid, display_name, is_active, is_test) VALUES (?, ?, ?, 1, ?)", [label, `uid-${label}`, label, isTest ? 1 : 0]);
    return result.insertId;
  }

  async function insertThread(type: ConversationType, zaloId: string, ownerBotId: number): Promise<number> {
    const [result] = await db.query<ResultSetHeader>(
      "INSERT INTO zalo_group (thread_type, zalo_group_id, owner_bot_id, name, read_messages, avatar_key) VALUES (?, ?, ?, ?, 1, ?)",
      [type, zaloId, ownerBotId, zaloId, type === ConversationType.Group ? `avatars/g/${zaloId}.jpg` : null]);
    if (type === ConversationType.Group) await storage.put(`avatars/g/${zaloId}.jpg`, Buffer.from("anh"), "image/jpeg");
    return result.insertId;
  }

  async function link(botId: number, groupId: number, left = false): Promise<void> {
    await db.query("INSERT INTO bot_group (bot_account_id, group_id, left_at) VALUES (?, ?, ?)", [botId, groupId, left ? new Date() : null]);
  }

  /** Một tin + một tệp đã cất (bytes byte) + chữ đã bóc. Trả id tin. */
  async function insertMessageWithFile(groupId: number, tag: string, bytes: number): Promise<number> {
    const [message] = await db.query<ResultSetHeader>(
      "INSERT INTO message (group_id, zalo_msg_id, kind, sender_uid, sent_at, text) VALUES (?, ?, 0, 'u1', NOW(3), ?)", [groupId, `m-${tag}`, tag]);
    const key = await storage.put(`files/${tag}.txt`, Buffer.alloc(bytes, 97), "text/plain");
    const [attachment] = await db.query<ResultSetHeader>(
      "INSERT INTO attachment (message_id, group_id, file_name, source_url, storage_key, stored_bytes, status) VALUES (?, ?, ?, '', ?, ?, ?)",
      [message.insertId, groupId, `${tag}.txt`, key, bytes, AttachmentStatus.Stored]);
    await db.query("INSERT INTO attachment_text (attachment_id, method, char_count, summary, text) VALUES (?, 'text', 1, '', 'a')", [attachment.insertId]);
    return message.insertId;
  }

  const fakeService = (overrides: Partial<{ storage: FileStorage }> = {}) => ({
    db, storage: overrides.storage ?? storage, stopAccount: async (id: number) => { stopped.push(id); },
  });

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });

  after(async () => {
    await db?.end();
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    for (const table of ["storage_cleanup", "job", "task", "attachment_text", "attachment", "message", "bot_group", "zalo_group", "bot_account", "audit_log"]) {
      await db.query(`DELETE FROM ${table}`);
    }
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "purge-test-"));
    storage = new LocalFileStorage(rootDir);
    stopped.length = 0;

    ids.testBot = await insertAccount("bot-thu", true);
    ids.realBot = await insertAccount("bot-that", false);
    ids.directTest = await insertThread(ConversationType.Direct, "nguoi-a", ids.testBot);
    ids.directReal = await insertThread(ConversationType.Direct, "nguoi-a", ids.realBot);
    ids.soloGroup = await insertThread(ConversationType.Group, "nhom-rieng", 0);
    ids.sharedGroup = await insertThread(ConversationType.Group, "nhom-chung", 0);
    ids.leftGroup = await insertThread(ConversationType.Group, "nhom-tung-co-nguoi-khac", 0);
    await link(ids.testBot, ids.soloGroup);
    await link(ids.testBot, ids.sharedGroup);
    await link(ids.realBot, ids.sharedGroup);
    await link(ids.testBot, ids.leftGroup);
    await link(ids.realBot, ids.leftGroup, true);
    ids.msgDirectTest = await insertMessageWithFile(ids.directTest, "rieng-thu", 100);
    ids.msgSolo = await insertMessageWithFile(ids.soloGroup, "nhom-rieng", 250);
    ids.msgShared = await insertMessageWithFile(ids.sharedGroup, "nhom-chung", 40);
    ids.msgDirectReal = await insertMessageWithFile(ids.directReal, "rieng-that", 10);
    await db.query(
      "INSERT INTO task (code, status, title, source, source_thread_id, source_message_id) VALUES ('~t1', 1, 'việc từ nhóm riêng', 1, ?, ?)",
      [ids.soloGroup, ids.msgSolo]);
    await db.query("INSERT INTO job (kind, status, payload) VALUES (?, ?, ?), (?, ?, ?)", [
      JobKind.AssistantGroupReply, JobStatus.Pending, JSON.stringify({ threadId: ids.soloGroup }),
      JobKind.AssistantGroupReply, JobStatus.Pending, JSON.stringify({ threadId: ids.sharedGroup }),
    ]);
  });

  test("tài khoản thật bị từ chối ở xem trước lẫn xóa; không mất gì", async () => {
    await assert.rejects(planTestAccountPurge(db, ids.realBot), PurgeRefusedError);
    await assert.rejects(purgeAccount(fakeService(), ids.realBot, { confirm_label: "bot-that", backup_confirmed: true }),
      (error: ApiError) => error.status === 409);
    assert.equal(await count("SELECT COUNT(*) AS n FROM bot_account WHERE id = ?", [ids.realBot]), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM zalo_group"), 5);
    assert.deepEqual(stopped, [], "tài khoản thật không bị dừng phiên");
  });

  test("xem trước đúng số: 1 cuộc riêng, 1 nhóm chỉ có nó, giữ 2 nhóm có tài khoản khác (kể cả đã rời), tin / tệp / dung lượng", async () => {
    const plan = await planTestAccountPurge(db, ids.testBot);
    assert.deepEqual([...plan.threadIds].sort(), [ids.directTest, ids.soloGroup].sort());
    assert.equal(plan.directCount, 1);
    assert.equal(plan.soloGroupCount, 1);
    assert.equal(plan.sharedGroupCount, 2);
    assert.equal(plan.messageCount, 2);
    assert.equal(plan.attachmentCount, 2);
    assert.equal(plan.storedFileCount, 2);
    assert.equal(plan.storedBytes, 350);
  });

  test("gõ sai nhãn hoặc chưa xác nhận sao lưu → 422, không xóa, không dừng phiên", async () => {
    await assert.rejects(purgeAccount(fakeService(), ids.testBot, { confirm_label: "bot-thu ", backup_confirmed: true }),
      (error: ApiError) => error.status === 422);
    await assert.rejects(purgeAccount(fakeService(), ids.testBot, { confirm_label: "bot-thu", backup_confirmed: "true" }),
      (error: ApiError) => error.status === 422);
    assert.equal(await count("SELECT COUNT(*) AS n FROM bot_account WHERE id = ?", [ids.testBot]), 1);
    assert.deepEqual(stopped, []);
  });

  test("xóa: sạch cuộc riêng + nhóm chỉ có nó (tin, tệp trong kho, chữ đã bóc); giữ nhóm chung, nhóm từng có người khác, cuộc riêng của tài khoản khác", async () => {
    const result = await purgeAccount(fakeService(), ids.testBot, { confirm_label: "bot-thu", backup_confirmed: true });
    assert.equal(result.storage_failed, 0);
    assert.equal(result.storage_deleted, 3, "2 tệp + 1 ảnh nhóm riêng");
    assert.deepEqual(stopped, [ids.testBot], "dừng phiên Zalo trước khi xóa");

    assert.equal(await count("SELECT COUNT(*) AS n FROM bot_account WHERE id = ?", [ids.testBot]), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM zalo_group WHERE id IN (?)", [[ids.directTest, ids.soloGroup]]), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM message WHERE id IN (?)", [[ids.msgDirectTest, ids.msgSolo]]), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM attachment WHERE group_id IN (?)", [[ids.directTest, ids.soloGroup]]), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM attachment_text"), 2, "chỉ còn chữ của 2 tệp giữ lại");
    await assert.rejects(fs.access(path.join(rootDir, "files/rieng-thu.txt")));
    await assert.rejects(fs.access(path.join(rootDir, "files/nhom-rieng.txt")));
    await assert.rejects(fs.access(path.join(rootDir, "avatars/g/nhom-rieng.jpg")));

    // Giữ: nhóm chung + nhóm tài khoản khác TỪNG ở (đã rời) + cuộc riêng của tài khoản thật, cùng tin / tệp của chúng
    assert.equal(await count("SELECT COUNT(*) AS n FROM zalo_group WHERE id IN (?)", [[ids.sharedGroup, ids.leftGroup, ids.directReal]]), 3);
    assert.equal(await count("SELECT COUNT(*) AS n FROM message WHERE id IN (?)", [[ids.msgShared, ids.msgDirectReal]]), 2);
    await fs.access(path.join(rootDir, "files/nhom-chung.txt"));
    await fs.access(path.join(rootDir, "avatars/g/nhom-chung.jpg"));
    assert.equal(await count("SELECT COUNT(*) AS n FROM bot_group WHERE bot_account_id = ?", [ids.testBot]), 0, "liên kết nhóm chung bị bỏ");
    assert.equal(await count("SELECT COUNT(*) AS n FROM bot_group WHERE bot_account_id = ?", [ids.realBot]), 2);

    // Việc giữ lại nhưng gỡ con trỏ nguồn; việc nền chờ chạy vào nhóm đã xóa bị bỏ, việc của nhóm chung không đụng
    const [tasks] = await db.query<RowDataPacket[]>("SELECT source_thread_id, source_message_id FROM task");
    assert.deepEqual(tasks.map((row) => [row.source_thread_id, row.source_message_id]), [[null, null]]);
    const [jobs] = await db.query<RowDataPacket[]>("SELECT status, JSON_EXTRACT(payload, '$.threadId') AS thread FROM job ORDER BY id");
    assert.deepEqual(jobs.map((row) => [Number(row.thread), Number(row.status)]),
      [[ids.soloGroup, JobStatus.Expired], [ids.sharedGroup, JobStatus.Pending]]);

    const [audit] = await db.query<RowDataPacket[]>("SELECT action, message FROM audit_log WHERE entity = 'bot_account' AND entity_id = ?", [ids.testBot]);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "purge");
    assert.match(String(audit[0].message), /1 cuộc riêng, 1 nhóm chỉ có nó, 2 tin, 2 tệp/);
  });

  test("xóa tệp trong kho hỏng: phần DB vẫn xong, khóa tệp ghi storage_cleanup; việc nền dọn lại được", async () => {
    const broken: FileStorage = { ...storage, put: storage.put.bind(storage), read: storage.read.bind(storage),
      delete: async () => { throw new Error("R2 503"); } };
    const result = await purgeAccount(fakeService({ storage: broken }), ids.testBot, { confirm_label: "bot-thu", backup_confirmed: true });
    assert.equal(result.storage_failed, 3);
    assert.equal(await count("SELECT COUNT(*) AS n FROM bot_account WHERE id = ?", [ids.testBot]), 0, "không bỏ dở phần DB");
    assert.equal(await count("SELECT COUNT(*) AS n FROM storage_cleanup"), 3);

    assert.equal(await retryStorageCleanup(db, storage), 3);
    assert.equal(await count("SELECT COUNT(*) AS n FROM storage_cleanup"), 0);
    await assert.rejects(fs.access(path.join(rootDir, "files/nhom-rieng.txt")));
  });
});
