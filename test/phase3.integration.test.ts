// Phase 3 trên MySQL THẬT: cờ trên tin + cảm xúc, bộ lập lịch (không chạy trùng, chạy bù), xóa tệp gốc quá hạn (giữ chữ,
// tôn trọng cờ «giữ»), chép tệp đĩa → R2, nhóm Mật không lọt sang AI, che dữ liệu cá nhân, câu hỏi kỹ thuật BVTV,
// trần token theo từng bot. Mô hình AI và R2 là bản giả.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { AssistantService } from "../src/assistant/assistant-service.js";
import type { GeminiContent, ModelClient } from "../src/assistant/gemini-client.js";
import { runTool, type ToolContext } from "../src/assistant/tools.js";
import { AssistantTurnStatus, AttachmentStatus, ContactRole, FlagSource, MessagePriority, ReplyState, ScheduleRunStatus } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { listOpenFlags, listOverdueFlags, markFlagHandled, recordReaction, upsertMessageFlag } from "../src/flags/message-flags.js";
import { Scheduler } from "../src/schedule/scheduler.js";
import { LocalFileStorage, R2WithLocalFallback, type R2FileStorage, type StoredObject } from "../src/storage/file-storage.js";
import { moveLocalFilesToR2 } from "../src/storage/move-to-r2.js";
import { findContactByUid, updateContact } from "../src/sync/contact-repository.js";
import { ensureGroup, updateGroupSettings } from "../src/sync/group-repository.js";
import { ingestDirectMessage, ingestGroupMessage, type IncomingGroupMessage } from "../src/sync/message-ingest.js";
import { purgeExpiredFiles } from "../src/sync/retention.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["schedule_run", "message_reaction", "message_flag", "assistant_turn", "attachment_text", "attachment", "message",
  "group_member", "bot_group", "zalo_group", "contact", "bot_account"];
const NOW = new Date("2026-10-08T03:00:00Z"); // 10:00 giờ Việt Nam
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function message(overrides: Partial<IncomingGroupMessage>): IncomingGroupMessage {
  return {
    zaloGroupId: "g-ban-hang", msgId: "1", cliMsgId: "", msgType: "webchat", senderUid: "u-lan", senderName: "Chị Lan",
    sentAtMs: NOW.getTime() - 3_600_000, content: "Báo giá gửi khách chưa?", quote: null, mentions: null, ...overrides,
  };
}

/** Mô hình giả: trả lần lượt các lượt đã soạn, ghi lại hướng dẫn hệ thống, tên công cụ, nội dung nhận được. */
class ScriptedModel implements ModelClient {
  readonly requests: { system: string; toolNames: string[]; contents: GeminiContent[] }[] = [];
  readonly searchWeb = async () => ({ text: "", sources: [], inputTokens: 0, outputTokens: 0 });
  constructor(private readonly turns: GeminiContent["parts"][], private readonly tokens = 1000) {}
  async generate(request: { system: string; contents: GeminiContent[]; tools: { name: string }[] }) {
    this.requests.push({ system: request.system, toolNames: request.tools.map((tool) => tool.name), contents: structuredClone(request.contents) });
    const parts = this.turns.shift();
    if (!parts) throw new Error("hết kịch bản");
    return { content: { role: "model" as const, parts }, inputTokens: this.tokens, outputTokens: 0 };
  }
}

describe("phase 3 — hạ tầng xử lý nền", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let botId: number;

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    const [result] = await db.query<any>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    botId = result.insertId;
  });

  async function seedGroup(zaloId = "g-ban-hang") {
    const { group } = await ensureGroup(db, zaloId, { readMessages: true, captureFiles: true });
    return group;
  }

  async function messageIdOf(groupId: number, zaloMsgId: string): Promise<number> {
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM message WHERE group_id = ? AND zalo_msg_id = ?", [groupId, zaloMsgId]);
    return Number(rows[0].id);
  }

  test("a flag only ever goes up in priority, a reaction marks it seen, and handling it closes it", async () => {
    const group = await seedGroup();
    await ingestGroupMessage({ db, defaults: { readMessages: true, captureFiles: false } }, botId, message({ msgId: "m1" }));
    const id = await messageIdOf(group.id, "m1");
    const due = new Date(NOW.getTime() + 2 * 3_600_000);
    await upsertMessageFlag(db, { messageId: id, groupId: group.id, priority: MessagePriority.Urgent, replyState: ReplyState.Waiting,
      source: FlagSource.Keyword, reason: "từ khóa «khiếu nại»", dueAt: due });
    // Lần phân loại sau hạ xuống «quan trọng» — không được làm mất mức KHẨN và lý do cũ
    await upsertMessageFlag(db, { messageId: id, groupId: group.id, priority: MessagePriority.Important, replyState: ReplyState.Waiting,
      source: FlagSource.Ai, reason: "AI" });
    let [flag] = await listOpenFlags(db);
    assert.equal(flag.priority, MessagePriority.Urgent);
    assert.equal(flag.reason, "từ khóa «khiếu nại»");

    // Thả cảm xúc = đã xem, vẫn còn trong danh sách chờ; tin không có trong kho thì bỏ qua
    assert.equal(await recordReaction(db, { groupId: group.id, zaloMsgId: "m1", reactorUid: "u-sep", icon: "/-strong", at: NOW }), id);
    assert.equal(await recordReaction(db, { groupId: group.id, zaloMsgId: "khong-co", reactorUid: "u-sep", icon: "/-strong", at: NOW }), null);
    [flag] = await listOpenFlags(db);
    assert.equal(flag.reply_state, ReplyState.Seen);
    // Quá hạn nhắc mà chưa xử lý → vào danh sách quá hạn
    assert.equal((await listOverdueFlags(db, new Date(due.getTime() + 1))).length, 1);
    assert.equal((await listOverdueFlags(db, new Date(due.getTime() - 1))).length, 0);

    assert.equal(await markFlagHandled(db, id, "u-sep", null, NOW), true);
    assert.deepEqual(await listOpenFlags(db), []);
    // Đã xử lý thì gắn cờ lại không mở lại
    await upsertMessageFlag(db, { messageId: id, groupId: group.id, priority: MessagePriority.Urgent, replyState: ReplyState.Waiting, source: FlagSource.Keyword, reason: "x" });
    assert.deepEqual(await listOpenFlags(db), []);
    // Gỡ cảm xúc thì xóa dòng
    await recordReaction(db, { groupId: group.id, zaloMsgId: "m1", reactorUid: "u-sep", icon: "", at: NOW });
    const [reactions] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM message_reaction");
    assert.equal(Number(reactions[0].n), 0);
  });

  test("two schedulers never run the same slot twice, and a failure is recorded with its message", async () => {
    let runs = 0;
    const tasks = [
      { name: "dem", label: "Đếm", spec: { every: "day", at: "07:00" } as const, run: async () => { runs += 1; await wait(30); } },
      { name: "hong", label: "Hỏng", spec: { every: "day", at: "07:00" } as const, run: async () => { throw new Error("hỏng có chủ ý"); } },
    ];
    const clock = () => NOW;
    const first = new Scheduler(db, tasks, () => null, clock);
    const second = new Scheduler(db, tasks, () => null, clock);
    await Promise.all([first.start(), second.start()]);
    await Promise.all([first.tick(), second.tick()]);
    await wait(100);
    first.stop();
    second.stop();
    assert.equal(runs, 1);
    const [rows] = await db.query<RowDataPacket[]>("SELECT task, last_slot, last_status, last_error FROM schedule_run ORDER BY task");
    assert.deepEqual(rows.map((row) => [row.task, row.last_slot, row.last_status]), [["dem", "2026-10-08", ScheduleRunStatus.Done], ["hong", "2026-10-08", ScheduleRunStatus.Failed]]);
    assert.match(String(rows[1].last_error), /hỏng có chủ ý/);
  });

  test("expired original files are deleted but their text and kept files survive", async () => {
    const group = await seedGroup();
    await updateGroupSettings(db, group.id, { fileRetentionDays: 180 });
    const deps = { db, defaults: { readMessages: true, captureFiles: true } };
    for (const msgId of ["f-cu", "f-giu", "f-moi"]) {
      await ingestGroupMessage(deps, botId, message({ msgId, msgType: "share.file", content: { title: `${msgId}.pdf`, href: "https://f/x", params: "{}" } }));
    }
    await db.query("UPDATE attachment SET status = ?, storage_key = CONCAT('k/', id)", [AttachmentStatus.Stored]);
    await db.query("UPDATE attachment SET created_at = ? WHERE file_name IN ('f-cu.pdf', 'f-giu.pdf')", [new Date(NOW.getTime() - 200 * 86_400_000)]);
    await db.query("UPDATE attachment SET keep_file = 1 WHERE file_name = 'f-giu.pdf'");
    const [old] = await db.query<RowDataPacket[]>("SELECT id FROM attachment WHERE file_name = 'f-cu.pdf'");
    await db.query("INSERT INTO attachment_text (attachment_id, method, char_count, summary, text) VALUES (?, 'text', 3, '', 'abc')", [old[0].id]);
    const deleted: string[] = [];
    const storage = { put: async () => "", read: async () => Readable.from([]), delete: async (key: string) => { deleted.push(key); } };

    assert.equal(await purgeExpiredFiles(db, storage, NOW), 1);
    assert.deepEqual(deleted, [`k/${old[0].id}`]);
    const [rows] = await db.query<RowDataPacket[]>("SELECT file_name, status, storage_key FROM attachment ORDER BY file_name");
    assert.deepEqual(rows.map((row) => [row.file_name, row.status, row.storage_key === null]),
      [["f-cu.pdf", AttachmentStatus.Expired, true], ["f-giu.pdf", AttachmentStatus.Stored, false], ["f-moi.pdf", AttachmentStatus.Stored, false]]);
    const [text] = await db.query<RowDataPacket[]>("SELECT text FROM attachment_text WHERE attachment_id = ?", [old[0].id]);
    assert.equal(text[0].text, "abc");
    // Chạy lại không xóa thêm gì
    assert.equal(await purgeExpiredFiles(db, storage, NOW), 0);
  });

  test("files still on disk are copied to R2, their keys rewritten, and a missing file does not stop the run", async () => {
    const group = await seedGroup();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bot-r2-"));
    const local = new LocalFileStorage(dir);
    await local.put("g/2026-10/1-a.pdf", Buffer.from("A"), "application/pdf");
    await ingestGroupMessage({ db, defaults: { readMessages: true, captureFiles: true } }, botId,
      message({ msgId: "f1", msgType: "share.file", content: { title: "a.pdf", href: "https://f/a", params: "{}" } }));
    await ingestGroupMessage({ db, defaults: { readMessages: true, captureFiles: true } }, botId,
      message({ msgId: "f2", msgType: "share.file", content: { title: "b.pdf", href: "https://f/b", params: "{}" } }));
    const [files] = await db.query<RowDataPacket[]>("SELECT id FROM attachment WHERE group_id = ? ORDER BY id", [group.id]);
    await db.query("UPDATE attachment SET storage_key = 'g/2026-10/1-a.pdf' WHERE id = ?", [files[0].id]);
    await db.query("UPDATE attachment SET storage_key = 'g/2026-10/mat-roi.pdf' WHERE id = ?", [files[1].id]);
    const uploaded = new Map<string, Buffer>();
    const fakeR2 = {
      prefix: "bot-tro-ly/",
      owns: (key: string) => key.startsWith("bot-tro-ly/"),
      put: async (key: string, body: Buffer) => { uploaded.set(`bot-tro-ly/${key}`, body); return `bot-tro-ly/${key}`; },
      read: async (key: string) => Readable.from([uploaded.get(key) ?? Buffer.alloc(0)]),
      delete: async (key: string) => { uploaded.delete(key); },
      list: async (): Promise<StoredObject[]> => [],
    } as unknown as R2FileStorage;
    const storage = new R2WithLocalFallback(fakeR2, local);
    // Trước khi chép: khóa cũ vẫn đọc được ở đĩa qua lớp dự phòng
    const before: Buffer[] = [];
    for await (const chunk of await storage.read("g/2026-10/1-a.pdf")) before.push(chunk as Buffer);
    assert.equal(Buffer.concat(before).toString(), "A");

    const result = await moveLocalFilesToR2(db, storage);
    assert.deepEqual(result, { moved: 1, missing: 1, failed: 0 });
    const [rows] = await db.query<RowDataPacket[]>("SELECT storage_key FROM attachment WHERE id = ?", [files[0].id]);
    assert.equal(rows[0].storage_key, "bot-tro-ly/g/2026-10/1-a.pdf");
    assert.equal(uploaded.get("bot-tro-ly/g/2026-10/1-a.pdf")?.toString(), "A");
    await assert.rejects(fs.access(path.join(dir, "g/2026-10/1-a.pdf")));
    // Chạy lại: khóa đã chuyển bỏ qua, tệp mất vẫn chỉ báo thiếu
    assert.deepEqual(await moveLocalFilesToR2(db, storage), { moved: 0, missing: 1, failed: 0 });
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("a confidential group is invisible to every assistant tool, even when the model asks for it by id", async () => {
    const open = await seedGroup();
    const secret = await seedGroup("g-bgd");
    await updateGroupSettings(db, secret.id, { isConfidential: true });
    const deps = { db, defaults: { readMessages: true, captureFiles: true } };
    await ingestGroupMessage(deps, botId, message({ msgId: "o1", content: "việc chung" }));
    await ingestGroupMessage(deps, botId, message({ zaloGroupId: "g-bgd", msgId: "s1", content: "lương thưởng mật" }));
    await ingestGroupMessage(deps, botId, message({ zaloGroupId: "g-bgd", msgId: "s2", msgType: "share.file",
      content: { title: "luong.xlsx", href: "https://f/l", params: "{}" } }));
    await db.query("UPDATE attachment SET status = ?, storage_key = 'k/1'", [AttachmentStatus.Stored]);
    const [secretFile] = await db.query<RowDataPacket[]>("SELECT id FROM attachment WHERE group_id = ?", [secret.id]);
    const context: ToolContext = { db, askerUid: "u-sep", filesToSend: [], now: NOW, readFile: async () => ({ error: "không được tới đây" }) };
    const window = { from: "2026-10-01T00:00:00+07:00", to: "2026-10-09T00:00:00+07:00" };

    const groups = await runTool(context, "list_groups", {}) as any;
    assert.deepEqual(groups.groups.map((g: { id: number }) => g.id), [open.id]);
    const stolen = await runTool(context, "get_group_messages", { group_id: secret.id, ...window }) as any;
    assert.match(stolen.error, /Mật/);
    const files = await runTool(context, "search_files", { query: "luong" }) as any;
    assert.equal(files.files.length, 0);
    assert.match((await runTool(context, "read_file", { attachment_id: secretFile[0].id }) as any).error, /Mật/);
    assert.match((await runTool(context, "send_file", { attachment_id: secretFile[0].id }) as any).error, /Mật/);
    const talk = await runTool(context, "get_conversation_with_person", { person_uid: "u-lan", ...window }) as any;
    assert.doesNotMatch(talk.messages, /lương thưởng/);
    assert.match(talk.messages, /việc chung/);
  });

  test("personal data in tool results is masked before reaching the model, the asker's own question is not", async () => {
    await seedGroup();
    await ingestGroupMessage({ db, defaults: { readMessages: true, captureFiles: false } }, botId,
      message({ msgId: "p1", content: "đại lý A số 0912345678, STK 0071000123456" }));
    const contact = (await findContactByUid(db, "u-lan"))!;
    await updateContact(db, contact.id, { kind: 2, role: ContactRole.Manager, companyId: null, note: "" });
    const asker = (await findContactByUid(db, "u-lan"))!;
    const groupId = (await seedGroup()).id;
    const model = new ScriptedModel([
      [{ functionCall: { name: "get_group_messages", args: { group_id: groupId, from: "2026-10-01T00:00:00+07:00", to: "2026-10-09T00:00:00+07:00" } } }],
      [{ text: "Dạ xong" }],
    ]);
    const service = new AssistantService(db, model, "gia-lap", { maxPerHour: 30, dailyTokenCap: 1_000_000 }, () => NOW,
      { privacy: { maskPersonalData: true, blockWebForAgroTechnical: true } });
    const reply = await service.answer({ botAccountId: botId, contact: asker, threadId: groupId, questionMessageId: null, question: "số 0987654321 là ai?" });
    assert.equal(reply.status, AssistantTurnStatus.Answered);
    const sent = JSON.stringify(model.requests[1].contents);
    assert.doesNotMatch(sent, /0912345678|0071000123456/);
    assert.match(sent, /SĐT \*\*\*678/);
    assert.match(sent, /0987654321/);
  });

  test("a pesticide technical question gets no web search tool and the verify-with-technical rule", async () => {
    await ingestDirectMessage({ db, defaults: { readMessages: true, captureFiles: false } }, botId,
      message({ zaloGroupId: "u-lan", senderUid: "u-lan", msgId: "d1", content: "hi" }));
    const asker = (await findContactByUid(db, "u-lan"))!;
    const technical = new ScriptedModel([[{ text: "Dạ" }]]);
    const service = new AssistantService(db, technical, "gia-lap", { maxPerHour: 30, dailyTokenCap: 1_000_000 }, () => NOW,
      { privacy: { maskPersonalData: true, blockWebForAgroTechnical: true } });
    await service.answer({ botAccountId: botId, contact: asker, threadId: 1, questionMessageId: null, question: "thuốc X pha với thuốc Y được không" });
    assert.equal(technical.requests[0].toolNames.includes("web_search"), false);
    assert.match(technical.requests[0].system, /cần phòng kỹ thuật xác nhận/);
    const normal = new ScriptedModel([[{ text: "Dạ" }]]);
    await new AssistantService(db, normal, "gia-lap", { maxPerHour: 30, dailyTokenCap: 1_000_000 }, () => NOW,
      { privacy: { maskPersonalData: true, blockWebForAgroTechnical: true } })
      .answer({ botAccountId: botId, contact: asker, threadId: 1, questionMessageId: null, question: "giá vàng hôm nay" });
    assert.equal(normal.requests[0].toolNames.includes("web_search"), true);
  });

  test("one bot hitting its own daily token cap stops while another bot keeps answering", async () => {
    await ingestDirectMessage({ db, defaults: { readMessages: true, captureFiles: false } }, botId,
      message({ zaloGroupId: "u-lan", senderUid: "u-lan", msgId: "d1", content: "hi" }));
    const asker = (await findContactByUid(db, "u-lan"))!;
    const [other] = await db.query<any>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot2', 'u-bot2', 'x')");
    const limits = { maxPerHour: 100, dailyTokenCap: 1_000_000, dailyTokenCapPerBot: 1500 };
    const model = new ScriptedModel([[{ text: "1" }], [{ text: "2" }], [{ text: "3" }]], 1000);
    const service = new AssistantService(db, model, "gia-lap", limits, () => NOW);
    const ask = (bot: number) => service.answer({ botAccountId: bot, contact: asker, threadId: 1, questionMessageId: null, question: "hỏi" });
    assert.equal((await ask(botId)).status, AssistantTurnStatus.Answered);
    assert.equal((await ask(botId)).status, AssistantTurnStatus.Answered);
    // 2.000 token ≥ trần 1.500 của bot1
    assert.equal((await ask(botId)).status, AssistantTurnStatus.DailyCapReached);
    assert.equal((await ask(Number(other.insertId))).status, AssistantTurnStatus.Answered);
  });
});
