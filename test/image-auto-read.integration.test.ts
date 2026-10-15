// Tự đọc ảnh gửi trong nhóm (15/10/2026) trên MySQL THẬT: ảnh Zalo đã cất kho → mô hình chép chữ (cất attachment_text,
// tính token) → cờ «chờ AI» → lô xét khẩn 5 phút (runAiReview) gắn KHẨN + hẹn báo người nhận; nhóm Mật không bao giờ đưa
// cho AI; đọc hỏng thử lại có giới hạn, tệp mất khỏi kho không chặn hàng; tắt cài đặt / chạm nửa trần token thì không đọc.
// Kho tệp và AI là bản giả.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, before, beforeEach, describe, test } from "node:test";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { runAiReview } from "../src/alerts/ai-review.js";
import { runImageAutoRead } from "../src/alerts/image-auto-read.js";
import { readAttachmentText } from "../src/assistant/file-reader.js";
import type { ModelClient } from "../src/assistant/gemini-client.js";
import type { AppConfig } from "../src/config.js";
import { DEFAULT_IMPORTANT_KEYWORDS, DEFAULT_STRICT_KEYWORDS, DEFAULT_URGENT_KEYWORDS } from "../src/config.js";
import { AttachmentStatus, ContactRole, FlagSource, GroupKind, JobKind, MessageKind, MessagePriority, ReplyState } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import type { FileStorage } from "../src/storage/file-storage.js";
import { ensureGroup } from "../src/sync/group-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["system_ai_usage", "alert_cursor", "attachment_text", "attachment", "message_flag", "job", "recipient_group", "recipient",
  "message", "group_member", "bot_group", "zalo_group", "contact", "bot_account", "assistant_turn"];
// Thứ 5 08/10/2026, 10:00 giờ VN
const NOW = new Date("2026-10-08T03:00:00Z");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const OCR_TEXT = "PHIẾU GIAO HÀNG Blaze 20 bao, SĐT 0909123456\nMô tả: bao phân bị vón cục, rách bao";

function makeConfig(): AppConfig {
  return {
    sessionEncryptionKey: "0".repeat(64),
    assistant: { dailyTokenCap: 1_000_000, autoReadImages: true, maxReadFileBytes: 5 * 1024 * 1024, readableFileTypes: ["pdf", "jpg", "jpeg", "png"] },
    privacy: { allowedAiProviders: ["1", "2", "3", "4", "5", "6"] },
    alerts: {
      enabled: true, urgentKeywords: DEFAULT_URGENT_KEYWORDS, importantKeywords: DEFAULT_IMPORTANT_KEYWORDS, strictKeywords: DEFAULT_STRICT_KEYWORDS,
      replyWaitMinutes: 120, vipWaitMinutes: 30, dailyReminderCap: 3, urgentMergeSeconds: 120, aiEnabled: true, telegramBotToken: "", telegramChatId: "",
    },
  } as unknown as AppConfig;
}

const storage = { read: async () => Readable.from([JPEG]) } as unknown as FileStorage;

interface Calls { reads: string[]; reviews: string[] }
const newCalls = (): Calls => ({ reads: [], reviews: [] });

/** Mô hình giả: đọc ảnh trả `OCR_TEXT` (hoặc ném lỗi 503), lô xét khẩn trả «khan» cho mọi tin được đưa. */
function fakeModel(calls: Calls, readFails = false): ModelClient {
  return {
    async readDocument(mime) {
      calls.reads.push(mime);
      if (readFails) throw new Error("Gemini 503: high demand");
      return { text: OCR_TEXT, inputTokens: 1200, outputTokens: 80 };
    },
    async generate(request) {
      const prompt = request.contents.map((content) => content.parts.map((part) => part.text ?? "").join("")).join("\n");
      calls.reviews.push(prompt);
      const ids = [...prompt.matchAll(/^#(\d+)/gm)].map((match) => Number(match[1]));
      const verdicts = ids.map((id) => ({ id, muc: "khan", ly_do: "ảnh hàng vón cục" }));
      return { content: { role: "model", parts: [{ text: JSON.stringify(verdicts) }] }, inputTokens: 300, outputTokens: 20 };
    },
  };
}

describe("tự đọc ảnh gửi trong nhóm", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let config: AppConfig;
  let groupId: number;
  let recipientId: number;

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    config = makeConfig();
    await db.query("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    groupId = (await ensureGroup(db, "g-a", { readMessages: true, captureFiles: true })).group.id;
    await db.query("UPDATE zalo_group SET group_kind = ?, name = 'Đại lý Thành Công' WHERE id = ?", [GroupKind.Customer, groupId]);
    const [contact] = await db.query<ResultSetHeader>("INSERT INTO contact (zalo_uid, display_name, kind, role) VALUES ('u-tp', 'Trưởng phòng', 2, ?)", [ContactRole.Manager]);
    const [recipient] = await db.query<ResultSetHeader>("INSERT INTO recipient (contact_id, name, rank_order, all_groups) VALUES (?, 'Trưởng phòng', 1, 1)", [contact.insertId]);
    recipientId = recipient.insertId;
  });

  /** Tin ảnh Zalo đã cất kho (không tên tệp; đuôi do bộ tải / migration 033 điền). */
  async function storedPhoto(minutesAgo = 1, caption = ""): Promise<{ messageId: number; attachmentId: number }> {
    const at = new Date(NOW.getTime() - minutesAgo * 60_000);
    const [message] = await db.query<ResultSetHeader>(
      `INSERT INTO message (group_id, zalo_msg_id, zalo_msg_type, kind, sender_uid, sender_name, sent_at, text)
       VALUES (?, ?, 'chat.photo', ?, 'u-khach', 'Anh Sáu', ?, ?)`,
      [groupId, String(Math.random()).slice(2, 12), MessageKind.Image, at, caption]);
    const [attachment] = await db.query<ResultSetHeader>(
      `INSERT INTO attachment (message_id, group_id, file_name, file_ext, source_url, storage_key, stored_bytes, status, stored_at)
       VALUES (?, ?, '', 'jpg', '', 'k/tep.jpg', ?, ?, ?)`,
      [message.insertId, groupId, JPEG.length, AttachmentStatus.Stored, at]);
    return { messageId: message.insertId, attachmentId: attachment.insertId };
  }

  test("ảnh mới: đọc một lần → cờ chờ AI → lô xét khẩn gắn KHẨN + hẹn báo người nhận (SĐT trong ảnh đã che)", async () => {
    const { messageId, attachmentId } = await storedPhoto(1, "anh xem giúp em");
    const calls = newCalls();
    const result = await runImageAutoRead(db, storage, config, NOW, fakeModel(calls));
    assert.deepEqual([result.read, result.failed], [1, 0]);
    assert.deepEqual(calls.reads, ["image/jpeg"]);
    const [text] = await db.query<RowDataPacket[]>("SELECT method, text FROM attachment_text WHERE attachment_id = ?", [attachmentId]);
    assert.deepEqual([text[0].method, text[0].text], ["gemini", OCR_TEXT]);
    const [pending] = await db.query<RowDataPacket[]>("SELECT priority, pending_ai FROM message_flag WHERE message_id = ?", [messageId]);
    assert.deepEqual([Number(pending[0].priority), Number(pending[0].pending_ai)], [MessagePriority.Normal, 1]);

    const review = await runAiReview(db, config, NOW, fakeModel(calls));
    assert.equal(review.urgent, 1);
    assert.match(calls.reviews[0], /anh xem giúp em \[Ảnh: PHIẾU GIAO HÀNG Blaze 20 bao, SĐT .* Mô tả: bao phân bị vón cục/);
    assert.doesNotMatch(calls.reviews[0], /0909123456/);
    const [flag] = await db.query<RowDataPacket[]>("SELECT priority, pending_ai, reason FROM message_flag WHERE message_id = ?", [messageId]);
    assert.deepEqual([Number(flag[0].priority), Number(flag[0].pending_ai)], [MessagePriority.Urgent, 0]);
    assert.match(String(flag[0].reason), /ảnh hàng vón cục/);
    const [jobs] = await db.query<RowDataPacket[]>("SELECT payload FROM job WHERE kind = ?", [JobKind.AlertDispatch]);
    assert.deepEqual(jobs.map((row) => (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload).recipientId), [recipientId]);
    const [usage] = await db.query<RowDataPacket[]>("SELECT purpose, input_tokens FROM system_ai_usage ORDER BY id");
    assert.deepEqual(usage.map((row) => [row.purpose, Number(row.input_tokens)]), [["image-read", 1200], ["alert-review", 300]]);
    // Lượt sau: ảnh đã đọc, không gọi lại mô hình
    assert.equal((await runImageAutoRead(db, storage, config, NOW, fakeModel(calls))).read, 0);
    assert.equal(calls.reads.length, 1);
  });

  test("tin đã KHẨN theo từ khóa chú thích: không gắn «chờ AI» (gắn sẽ hoãn cảnh báo của nó)", async () => {
    const { messageId } = await storedPhoto(1, "khiếu nại gấp");
    await db.query(`INSERT INTO message_flag (message_id, group_id, priority, reply_state, source, reason) VALUES (?, ?, ?, ?, ?, 'từ khóa')`,
      [messageId, groupId, MessagePriority.Urgent, ReplyState.NotNeeded, FlagSource.Keyword]);
    await runImageAutoRead(db, storage, config, NOW, fakeModel(newCalls()));
    const [flag] = await db.query<RowDataPacket[]>("SELECT priority, pending_ai FROM message_flag WHERE message_id = ?", [messageId]);
    assert.deepEqual([Number(flag[0].priority), Number(flag[0].pending_ai)], [MessagePriority.Urgent, 0]);
  });

  test("nhóm Mật, nhóm không bật «Đọc tin», ảnh cất quá 24 giờ: không đưa cho AI", async () => {
    await db.query("UPDATE zalo_group SET is_confidential = 1 WHERE id = ?", [groupId]);
    await storedPhoto();
    const calls = newCalls();
    await runImageAutoRead(db, storage, config, NOW, fakeModel(calls));
    await db.query("UPDATE zalo_group SET is_confidential = 0, read_messages = 0 WHERE id = ?", [groupId]);
    await runImageAutoRead(db, storage, config, NOW, fakeModel(calls));
    await db.query("UPDATE zalo_group SET read_messages = 1 WHERE id = ?", [groupId]);
    await db.query("UPDATE attachment SET stored_at = ?", [new Date(NOW.getTime() - 25 * 60 * 60_000)]);
    await runImageAutoRead(db, storage, config, NOW, fakeModel(calls));
    assert.deepEqual([calls.reads.length, calls.reviews.length], [0, 0]);
  });

  test("tắt cài đặt / ảnh không nằm trong loại tệp được đọc / chạm nửa trần token: không đọc", async () => {
    await storedPhoto();
    const calls = newCalls();
    config.assistant.autoReadImages = false;
    assert.equal((await runImageAutoRead(db, storage, config, NOW, fakeModel(calls))).skipped, "đã tắt");
    config.assistant.autoReadImages = true;
    config.assistant.readableFileTypes = ["pdf"];
    assert.equal((await runImageAutoRead(db, storage, config, NOW, fakeModel(calls))).skipped, "ảnh không nằm trong loại tệp bot được đọc");
    config.assistant.readableFileTypes = [];
    // 600 token đã dùng, trần 1.000 → nửa trần (500) đã chạm: chừa phần còn lại cho xét khẩn tin chữ / bản tin / trợ lý
    await db.query("INSERT INTO system_ai_usage (purpose, model, item_count, input_tokens, output_tokens, duration_ms) VALUES ('alert-review', '', 1, 600, 0, 1)");
    config.assistant.dailyTokenCap = 1000;
    assert.equal((await runImageAutoRead(db, storage, config, NOW, fakeModel(calls))).skipped, "chạm phần trần token dành cho đọc ảnh");
    assert.equal(calls.reads.length, 0);
  });

  test("đọc hỏng: dừng lượt, ảnh mới đi trước, thử lại sau 30 phút, bỏ sau 3 lần; trợ lý vẫn đọc lại được", async () => {
    const first = await storedPhoto(3);
    const calls = newCalls();
    const result = await runImageAutoRead(db, storage, config, NOW, fakeModel(calls, true));
    assert.deepEqual([result.read, result.failed, calls.reads.length], [0, 1, 1]);
    const [row] = await db.query<RowDataPacket[]>("SELECT method, text, summary FROM attachment_text WHERE attachment_id = ?", [first.attachmentId]);
    assert.deepEqual([row[0].method, row[0].text], ["unsupported", null]);
    assert.match(String(row[0].summary), /^tự đọc ảnh lỗi lần 1: Không đọc được/);
    // Ảnh mới tới: đọc ngay (ảnh hỏng chưa tới giờ thử lại, và ảnh chưa đọc lần nào đi trước)
    const second = await storedPhoto(1);
    assert.equal((await runImageAutoRead(db, storage, config, NOW, fakeModel(calls))).read, 1);
    assert.equal(calls.reads.length, 2);
    // Lần 2, lần 3 hỏng (mỗi lần cách 31 phút) → thôi, không thử lần 4
    for (const attempt of [2, 3]) {
      await db.query("UPDATE attachment_text SET extracted_at = ? WHERE attachment_id = ?", [new Date(NOW.getTime() - 31 * 60_000), first.attachmentId]);
      await runImageAutoRead(db, storage, config, NOW, fakeModel(calls, true));
      const [after] = await db.query<RowDataPacket[]>("SELECT summary FROM attachment_text WHERE attachment_id = ?", [first.attachmentId]);
      assert.match(String(after[0].summary), new RegExp(`^tự đọc ảnh lỗi lần ${attempt}:`));
    }
    await db.query("UPDATE attachment_text SET extracted_at = ? WHERE attachment_id = ?", [new Date(NOW.getTime() - 31 * 60_000), first.attachmentId]);
    const readsBefore = calls.reads.length;
    await runImageAutoRead(db, storage, config, NOW, fakeModel(calls));
    assert.equal(calls.reads.length, readsBefore);
    assert.ok(second.attachmentId > first.attachmentId);
    // Trợ lý được nhờ đọc: đọc lại ngay
    const reread = await readAttachmentText({ db, storage, maxFileBytes: 5 * 1024 * 1024,
      readDocument: async () => ({ text: OCR_TEXT, inputTokens: 1, outputTokens: 1 }) }, first.attachmentId);
    assert.ok(!("error" in reread));
    assert.equal(reread.text, OCR_TEXT);
  });

  test("tệp mất khỏi kho (đọc kho ném lỗi): ghi hỏng, không chặn đầu hàng", async () => {
    const lost = await storedPhoto(2);
    const ok = await storedPhoto(1);
    const brokenStorage = { read: async () => { throw new Error("ENOENT: no such file"); } } as unknown as FileStorage;
    const calls = newCalls();
    const result = await runImageAutoRead(db, brokenStorage, config, NOW, fakeModel(calls));
    assert.deepEqual([result.read, result.failed], [0, 1]);
    const [row] = await db.query<RowDataPacket[]>("SELECT summary FROM attachment_text WHERE attachment_id = ?", [lost.attachmentId]);
    assert.match(String(row[0].summary), /^tự đọc ảnh lỗi lần 1: .*ENOENT/);
    // Lượt sau (kho bình thường): ảnh kế được đọc, ảnh mất chờ tới giờ thử lại
    assert.equal((await runImageAutoRead(db, storage, config, NOW, fakeModel(calls))).read, 1);
    const [okRow] = await db.query<RowDataPacket[]>("SELECT method FROM attachment_text WHERE attachment_id = ?", [ok.attachmentId]);
    assert.equal(okRow[0].method, "gemini");
  });
});
