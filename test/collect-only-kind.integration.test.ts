// Loại tài khoản bot «Normal» (chỉ gom dữ liệu) và nhóm / cuộc «chỉ lưu» trên MySQL THẬT (17/10/2026):
//   - nhóm chỉ có bot Normal: không cảnh báo (từ khóa + AI), không đề xuất việc, không đọc ảnh, không vào bản tin / báo cáo;
//   - nhóm có cả bot Normal lẫn bot Trợ lý: xử lý như thường;
//   - tin riêng gửi tới bot Normal: chỉ lưu, không xếp việc trả lời; tin nhóm tới bot Normal không gọi bộ trả lời nhóm;
//   - chọn bot gửi chỉ trong bot Trợ lý, hết thì bỏ việc; ô soạn Hội thoại bị chặn.
// Zalo, AI và kho tệp là bản giả.
//
// Chạy: TEST_DATABASE_URL=mysql://root:<mật khẩu>@127.0.0.1:3308/bot_tro_ly_test_kind npm test

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { after, before, beforeEach, describe, test } from "node:test";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { runAiReview } from "../src/alerts/ai-review.js";
import { AlertService } from "../src/alerts/alert-service.js";
import { runImageAutoRead } from "../src/alerts/image-auto-read.js";
import type { AssistantService } from "../src/assistant/assistant-service.js";
import type { ModelClient } from "../src/assistant/gemini-client.js";
import { loadBriefScope } from "../src/briefs/brief-scope.js";
import type { AppConfig } from "../src/config.js";
import { DEFAULT_IMPORTANT_KEYWORDS, DEFAULT_STRICT_KEYWORDS, DEFAULT_URGENT_KEYWORDS } from "../src/config.js";
import { AttachmentStatus, BotAccountKind, ContactRole, GroupKind, JobKind, MessageKind, MessagePriority } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import type { BotHaltControl } from "../src/messaging/bot-halt.js";
import { buildWorkCalendar } from "../src/schedule/work-calendar.js";
import type { FileStorage } from "../src/storage/file-storage.js";
import { SyncService } from "../src/sync-service.js";
import { collectOnlyThreadSql, isCollectOnlyThread } from "../src/sync/collect-only.js";
import { directKey, ensureGroup, ensureThread, findThreadById } from "../src/sync/group-repository.js";
import { ingestGroupMessage, type IncomingGroupMessage } from "../src/sync/message-ingest.js";
import { runTaskExtraction } from "../src/tasks/task-proposals.js";
import { AccountRunner } from "../src/zalo/account-runner.js";
import type { BotAccountRow } from "../src/zalo/bot-account-repository.js";
import { CollectOnlyAccountError } from "../src/zalo/collect-only-account-error.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["system_ai_usage", "alert_log", "alert_cursor", "attachment_text", "attachment", "message_reaction", "message_flag", "job", "task_event",
  "task", "assistant_turn", "recipient_vip", "recipient_group", "recipient", "message", "group_member", "bot_group", "zalo_group", "contact", "bot_account", "audit_log"];
// Thứ 5 08/10/2026, 10:00 giờ VN — trong giờ làm việc
const NOW = new Date("2026-10-08T03:00:00Z");
const calendar = buildWorkCalendar({ workHours: "08:30-12:00, 13:30-17:30", workDays: [1, 2, 3, 4, 5, 6], quietHours: "21:00-06:30", holidays: "" });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const storage = { read: async () => Readable.from([JPEG]) } as unknown as FileStorage;

function makeConfig(): AppConfig {
  return {
    sessionEncryptionKey: "0".repeat(64),
    assistant: { dailyTokenCap: 1_000_000, autoReadImages: true, maxReadFileBytes: 5 * 1024 * 1024, readableFileTypes: ["jpg"], sendIntervalMs: 0, groupTriggerKeywords: ["bot"] },
    privacy: { allowedAiProviders: ["1", "2", "3", "4", "5", "6"] },
    calendar: { workHours: "08:30-12:00, 13:30-17:30", workDays: ["1", "2", "3", "4", "5", "6"], quietHours: "21:00-06:30", holidays: "" },
    alerts: {
      enabled: true, urgentKeywords: DEFAULT_URGENT_KEYWORDS, importantKeywords: DEFAULT_IMPORTANT_KEYWORDS, strictKeywords: DEFAULT_STRICT_KEYWORDS,
      replyWaitMinutes: 120, vipWaitMinutes: 30, dailyReminderCap: 3, urgentMergeSeconds: 120, aiEnabled: true, telegramBotToken: "", telegramChatId: "",
    },
    botHalt: { halted: false },
    defaultGroupRead: true, defaultGroupCaptureFiles: false, defaultDirectRead: true, defaultDirectCaptureFiles: false,
  } as unknown as AppConfig;
}

function message(zaloGroupId: string, overrides: Partial<IncomingGroupMessage> = {}): IncomingGroupMessage {
  return {
    zaloGroupId, msgId: String(Math.random()).slice(2, 12), cliMsgId: "", msgType: "webchat", senderUid: "u-nv", senderName: "Nhân viên",
    sentAtMs: NOW.getTime() - 60_000, content: "xin chào", quote: null, mentions: null, ...overrides,
  };
}

describe("tài khoản bot loại Normal và nhóm «chỉ lưu»", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let config: AppConfig;
  let alerts: AlertService;
  let normalBot = 0;
  let assistantBot = 0;
  let onlyNormal = 0; // nhóm chỉ có bot Normal
  let both = 0; // nhóm có cả bot Normal lẫn bot Trợ lý
  let noBots = 0; // nhóm không còn bot nào (giữ như cũ)

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
    normalBot = (await db.query<ResultSetHeader>("INSERT INTO bot_account (label, zalo_uid, session_cipher, kind) VALUES ('thu-thap', 'u-bot-n', 'x', ?)", [BotAccountKind.Normal]))[0].insertId;
    assistantBot = (await db.query<ResultSetHeader>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('tro-ly', 'u-bot-a', 'x')"))[0].insertId;
    const READ = { readMessages: true, captureFiles: true };
    onlyNormal = (await ensureGroup(db, "g-only", READ)).group.id;
    both = (await ensureGroup(db, "g-both", READ)).group.id;
    noBots = (await ensureGroup(db, "g-none", READ)).group.id;
    for (const id of [onlyNormal, both, noBots]) await db.query("UPDATE zalo_group SET group_kind = ?, name = CONCAT('Nhóm ', zalo_group_id) WHERE id = ?", [GroupKind.Internal, id]);
    await db.query("INSERT INTO bot_group (bot_account_id, group_id) VALUES (?, ?), (?, ?), (?, ?)", [normalBot, onlyNormal, normalBot, both, assistantBot, both]);
    await db.query(`INSERT INTO contact (zalo_uid, display_name, kind, role) VALUES
      ('u-tp', 'Trưởng phòng', 2, ${ContactRole.Manager}), ('u-nv', 'Nhân viên', 2, ${ContactRole.None}), ('u-giao', 'Chị Giao', 2, ${ContactRole.Manager})`);
    const [contact] = await db.query<RowDataPacket[]>("SELECT id FROM contact WHERE zalo_uid = 'u-tp'");
    await db.query("INSERT INTO recipient (contact_id, name, rank_order, all_groups) VALUES (?, 'Trưởng phòng', 1, 1)", [contact[0].id]);
    alerts = new AlertService(db, config, () => calendar, () => undefined, async () => undefined);
  });

  async function receive(zaloGroupId: string, overrides: Partial<IncomingGroupMessage> = {}): Promise<{ id: number; groupId: number }> {
    const incoming = message(zaloGroupId, overrides);
    await ingestGroupMessage({ db, defaults: { readMessages: true, captureFiles: false } }, 1, incoming);
    const [rows] = await db.query<RowDataPacket[]>("SELECT id, group_id FROM message WHERE zalo_msg_id = ?", [incoming.msgId]);
    return { id: Number(rows[0].id), groupId: Number(rows[0].group_id) };
  }

  const countRows = async (sql: string, params: unknown[] = []): Promise<number> => Number(((await db.query<RowDataPacket[]>(sql, params))[0])[0].n);

  test("migration 041: cột kind mặc định 0 (Trợ lý); bot Normal được lưu là 1", async () => {
    const [rows] = await db.query<RowDataPacket[]>("SELECT id, kind FROM bot_account ORDER BY id");
    assert.deepEqual(rows.map((row) => [Number(row.id), Number(row.kind)]), [[normalBot, BotAccountKind.Normal], [assistantBot, BotAccountKind.Assistant]]);
  });

  test("hàm SQL «chỉ lưu»: nhóm chỉ bot Normal = có; có bot Trợ lý = không; không còn bot nào = không; cuộc riêng theo bot chủ cuộc", async () => {
    const dmNormal = (await ensureThread(db, directKey(normalBot, "u-x"), { readMessages: true, captureFiles: false }, "X")).group.id;
    const dmAssistant = (await ensureThread(db, directKey(assistantBot, "u-y"), { readMessages: true, captureFiles: false }, "Y")).group.id;
    assert.equal(await isCollectOnlyThread(db, onlyNormal), true);
    assert.equal(await isCollectOnlyThread(db, both), false);
    assert.equal(await isCollectOnlyThread(db, noBots), false);
    assert.equal(await isCollectOnlyThread(db, dmNormal), true);
    assert.equal(await isCollectOnlyThread(db, dmAssistant), false);
    // Bot Trợ lý rời nhóm chung → nhóm thành «chỉ lưu»; vào lại → xử lý như thường
    await db.query("UPDATE bot_group SET left_at = NOW(3) WHERE bot_account_id = ? AND group_id = ?", [assistantBot, both]);
    assert.equal(await isCollectOnlyThread(db, both), true);
    await db.query("UPDATE bot_group SET left_at = NULL WHERE bot_account_id = ? AND group_id = ?", [assistantBot, both]);
    assert.equal(await isCollectOnlyThread(db, both), false);
    // Đổi loại tài khoản có hiệu lực ngay ở truy vấn kế tiếp
    await db.query("UPDATE bot_account SET kind = ? WHERE id = ?", [BotAccountKind.Normal, assistantBot]);
    assert.equal(await isCollectOnlyThread(db, both), true, "cả hai bot đều thành Normal → nhóm chung thành chỉ lưu");
  });

  test("cảnh báo từ khóa: tin KHẨN ở nhóm chỉ bot Normal không lập cờ, không hẹn báo; ở nhóm có bot Trợ lý thì báo như thường", async () => {
    const quiet = await receive("g-only", { content: "Đại lý khiếu nại hàng vón cục, xử lý gấp" });
    await alerts.onNewMessage({ threadId: quiet.groupId, messageId: quiet.id }, NOW);
    assert.equal(await countRows("SELECT COUNT(*) AS n FROM message_flag WHERE message_id = ?", [quiet.id]), 0);
    assert.equal(await countRows("SELECT COUNT(*) AS n FROM job WHERE kind = ?", [JobKind.AlertDispatch]), 0);

    const loud = await receive("g-both", { content: "Đại lý khiếu nại hàng vón cục, xử lý gấp" });
    await alerts.onNewMessage({ threadId: loud.groupId, messageId: loud.id }, NOW);
    const [flag] = await db.query<RowDataPacket[]>("SELECT priority FROM message_flag WHERE message_id = ?", [loud.id]);
    assert.equal(Number(flag[0].priority), MessagePriority.Urgent);
    assert.equal(await countRows("SELECT COUNT(*) AS n FROM job WHERE kind = ?", [JobKind.AlertDispatch]), 1);
  });

  test("AI xét lô: tin chờ AI của nhóm chỉ lưu không đưa cho mô hình và được gỡ cờ chờ; nhóm có bot Trợ lý vẫn được xét", async () => {
    const quiet = await receive("g-only", { content: "Khách la quá trời luôn anh ơi không chịu nhận hàng" });
    const loud = await receive("g-both", { content: "Khách la quá trời luôn anh ơi không chịu nhận hàng" });
    for (const entry of [quiet, loud]) {
      await db.query("INSERT INTO message_flag (message_id, group_id, priority, pending_ai, source) VALUES (?, ?, 0, 1, 0)", [entry.id, entry.groupId]);
    }
    const seen: string[] = [];
    const model: ModelClient = {
      generate: async (request) => {
        seen.push(request.contents.map((content) => content.parts.map((part) => part.text ?? "").join("")).join("\n"));
        return { content: { role: "model", parts: [{ text: "[]" }] }, inputTokens: 10, outputTokens: 1 };
      },
    };
    await runAiReview(db, config, NOW, model);
    const prompt = seen.join("\n");
    assert.ok(prompt.includes(`#${loud.id}`), "tin ở nhóm có bot Trợ lý phải được xét");
    assert.ok(!prompt.includes(`#${quiet.id} `) && !prompt.includes(`#${quiet.id}\n`), "tin ở nhóm chỉ lưu không được đưa cho AI");
    const [flags] = await db.query<RowDataPacket[]>("SELECT message_id, pending_ai FROM message_flag WHERE message_id = ?", [quiet.id]);
    assert.equal(Number(flags[0].pending_ai), 0);
  });

  test("tự đọc ảnh: ảnh ở nhóm chỉ lưu không được đọc; ảnh ở nhóm có bot Trợ lý được đọc", async () => {
    const photo = async (groupId: number): Promise<void> => {
      const [msg] = await db.query<ResultSetHeader>(
        `INSERT INTO message (group_id, zalo_msg_id, zalo_msg_type, kind, sender_uid, sender_name, sent_at, text) VALUES (?, ?, 'chat.photo', ?, 'u-khach', 'Khách', ?, '')`,
        [groupId, String(Math.random()).slice(2, 12), MessageKind.Image, new Date(NOW.getTime() - 60_000)]);
      await db.query(
        `INSERT INTO attachment (message_id, group_id, file_name, file_ext, source_url, storage_key, stored_bytes, status, stored_at) VALUES (?, ?, '', 'jpg', '', 'k/a.jpg', ?, ?, ?)`,
        [msg.insertId, groupId, JPEG.length, AttachmentStatus.Stored, new Date(NOW.getTime() - 60_000)]);
    };
    await photo(onlyNormal);
    await photo(both);
    const reads: string[] = [];
    const model: ModelClient = {
      readDocument: async (mime: string) => { reads.push(mime); return { text: "PHIẾU GIAO HÀNG", inputTokens: 10, outputTokens: 5 }; },
      generate: async () => ({ content: { role: "model", parts: [{ text: "[]" }] }, inputTokens: 1, outputTokens: 1 }),
    } as unknown as ModelClient;
    const result = await runImageAutoRead(db, storage, config, NOW, model);
    assert.equal(result.read, 1);
    assert.equal(reads.length, 1);
    const [rows] = await db.query<RowDataPacket[]>("SELECT a.group_id FROM attachment_text t JOIN attachment a ON a.id = t.attachment_id");
    assert.deepEqual(rows.map((row) => Number(row.group_id)), [both]);
  });

  test("bắt việc tự động: câu giao việc ở nhóm chỉ lưu không được đưa cho AI / không có đề xuất; ở nhóm có bot Trợ lý thì có", async () => {
    const quiet = await receive("g-only", { senderUid: "u-giao", senderName: "Chị Giao", content: "Minh nhớ làm báo cáo tuần trước thứ 6 nhé" });
    const loud = await receive("g-both", { senderUid: "u-giao", senderName: "Chị Giao", content: "Minh nhớ làm báo cáo tuần trước thứ 6 nhé" });
    const prompts: string[] = [];
    const model: ModelClient = {
      generate: async (request) => {
        prompts.push(request.contents.map((content) => content.parts.map((part) => part.text ?? "").join("")).join("\n"));
        return { content: { role: "model", parts: [{ text: "[]" }] }, inputTokens: 10, outputTokens: 1 };
      },
    };
    const result = await runTaskExtraction(db, config, calendar, NOW, model);
    assert.equal(result.reviewed, 1);
    assert.ok(prompts[0].includes(`#${loud.id} `));
    assert.ok(!prompts[0].includes(`#${quiet.id} `));
  });

  test("bản tin / báo cáo định kỳ: phạm vi «mọi nhóm» và phạm vi chọn nhóm đều bỏ nhóm chỉ lưu", async () => {
    const [recipients] = await db.query<RowDataPacket[]>("SELECT id, all_groups FROM recipient");
    const all = await loadBriefScope(db, { id: Number(recipients[0].id), all_groups: 1, zalo_uid: "u-tp" });
    assert.ok(all.groupIds.includes(both) && all.groupIds.includes(noBots));
    assert.ok(!all.groupIds.includes(onlyNormal));
    assert.ok(!all.aiGroupIds.includes(onlyNormal));

    await db.query("UPDATE recipient SET all_groups = 0 WHERE id = ?", [recipients[0].id]);
    await db.query("INSERT INTO recipient_group (recipient_id, group_id) VALUES (?, ?), (?, ?)", [recipients[0].id, onlyNormal, recipients[0].id, both]);
    const chosen = await loadBriefScope(db, { id: Number(recipients[0].id), all_groups: 0, zalo_uid: "u-tp" });
    assert.deepEqual(chosen.groupIds, [both]);
  });

  describe("tài khoản chạy thật (runner giả phiên Zalo)", () => {
    function accountRow(id: number, kind: BotAccountKind): BotAccountRow {
      return { id, label: kind === BotAccountKind.Normal ? "thu-thap" : "tro-ly", zalo_uid: "u-bot", display_name: "", session_cipher: "x", status: 1, is_active: 1, kind };
    }
    function makeRunner(id: number, kind: BotAccountKind, wakes: { n: number }): AccountRunner {
      const downloader = { enqueue: () => undefined } as never;
      const jobs = { wake: () => { wakes.n += 1; } };
      const botHalt = { status: () => ({ halted: false }) } as unknown as BotHaltControl;
      return new AccountRunner(accountRow(id, kind), db, config, downloader, storage, {} as AssistantService, jobs, botHalt);
    }
    const userMessage = (text: string) => ({
      type: 0, threadId: "u-tp", isSelf: false,
      data: { msgId: String(Math.random()).slice(2, 12), cliMsgId: "1", msgType: "webchat", uidFrom: "u-tp", dName: "Trưởng phòng", ts: String(NOW.getTime()), content: text },
    });

    test("tin riêng tới bot Normal: lưu tin, KHÔNG xếp việc trả lời; cùng tin tới bot Trợ lý (người có vai trò) thì có việc trả lời", async () => {
      const wakes = { n: 0 };
      await (makeRunner(normalBot, BotAccountKind.Normal, wakes) as any).handleDirectMessage(userMessage("tóm tắt nhóm A hôm nay"));
      assert.equal(await countRows("SELECT COUNT(*) AS n FROM message m JOIN zalo_group g ON g.id = m.group_id WHERE g.thread_type = 0 AND g.owner_bot_id = ?", [normalBot]), 1);
      assert.equal(await countRows("SELECT COUNT(*) AS n FROM job WHERE kind = ?", [JobKind.AssistantDirectReply]), 0);
      assert.equal(wakes.n, 0);

      await (makeRunner(assistantBot, BotAccountKind.Assistant, wakes) as any).handleDirectMessage(userMessage("tóm tắt nhóm A hôm nay"));
      assert.equal(await countRows("SELECT COUNT(*) AS n FROM job WHERE kind = ?", [JobKind.AssistantDirectReply]), 1);
    });

    test("tin riêng tới bot Normal cũng im lặng với lệnh tắt / bật bot và «hướng dẫn» (không gửi gì ra Zalo)", async () => {
      const wakes = { n: 0 };
      const runner = makeRunner(normalBot, BotAccountKind.Normal, wakes);
      let gated = 0;
      (runner as any).botHalt = { status: () => { gated += 1; return { halted: false }; } };
      await (runner as any).handleDirectMessage(userMessage("tắt bot"));
      await (runner as any).handleDirectMessage(userMessage("hướng dẫn"));
      assert.equal(gated, 0, "cổng lệnh tắt / bật bot không được chạy cho bot Normal");
      assert.equal(await countRows("SELECT COUNT(*) AS n FROM job"), 0);
    });

    test("tin nhóm tới bot Normal chỉ lưu, không gọi bộ trả lời nhóm; bot Trợ lý thì gọi; đổi loại có hiệu lực ngay", async () => {
      const wakes = { n: 0 };
      const handled: string[] = [];
      const listener = Object.assign(new EventEmitter(), { start: () => undefined, stop: () => undefined, requestOldMessages: () => undefined });
      const runner = makeRunner(normalBot, BotAccountKind.Normal, wakes);
      (runner as any).groupReplier.handle = (_message: unknown, incoming: IncomingGroupMessage) => { handled.push(incoming.msgId); };
      (runner as any).attachListener({ listener });
      const groupMessage = (id: string) => ({
        type: 1, threadId: "g-only", isSelf: false,
        data: { msgId: id, cliMsgId: "1", msgType: "webchat", uidFrom: "u-nv", dName: "Nhân viên", ts: String(NOW.getTime()), content: "bot ơi tóm tắt giúp", idTo: "g-only" },
      });
      listener.emit("message", groupMessage("m-1"));
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(await countRows("SELECT COUNT(*) AS n FROM message WHERE zalo_msg_id = 'm-1'"), 1, "tin vẫn được lưu");
      assert.deepEqual(handled, []);
      runner.setKind(BotAccountKind.Assistant);
      listener.emit("message", groupMessage("m-2"));
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.deepEqual(handled, ["m-2"]);
    });

    test("việc trả lời xếp hàng từ lúc tài khoản còn là Trợ lý: sau khi đổi sang Normal bị BỎ (JobSkippedError), không thử lại", async () => {
      const runner = makeRunner(assistantBot, BotAccountKind.Assistant, { n: 0 });
      runner.setKind(BotAccountKind.Normal);
      const job = { id: 1, kind: JobKind.AssistantDirectReply, payload: {}, serialKey: null, attempts: 1, maxAttempts: 3, createdAt: NOW };
      await assert.rejects(runner.runDirectReplyJob(job as never), (error: Error) => error.name === "JobSkippedError");
      await assert.rejects(runner.runGroupReplyJob(job as never), (error: Error) => error.name === "JobSkippedError");
    });
  });

  describe("chọn bot gửi (SyncService)", () => {
    /** SyncService không dựng đầy đủ: chỉ cần db + bản đồ runner giả có `isCollectOnly`. */
    function makeService(runners: Record<number, { isCollectOnly: boolean }>): any {
      const service = Object.create(SyncService.prototype) as any;
      service.db = db;
      service.config = config;
      service.runners = new Map(Object.entries(runners).map(([id, runner]) => [Number(id), runner]));
      return service;
    }

    test("nhóm có cả hai bot: chọn bot Trợ lý; chỉ bot Normal: bỏ việc (không rơi về bot Normal hay bot khác)", async () => {
      const normal = { isCollectOnly: true, name: "normal" };
      const assistant = { isCollectOnly: false, name: "assistant" };
      const service = makeService({ [normalBot]: normal, [assistantBot]: assistant });
      const bothThread = (await findThreadById(db, both))!;
      assert.equal(await service.runnerForThread(bothThread), assistant);
      const onlyThread = (await findThreadById(db, onlyNormal))!;
      await assert.rejects(service.runnerForThread(onlyThread), CollectOnlyAccountError);
    });

    test("cuộc riêng của bot Normal: bỏ việc; cuộc riêng của bot Trợ lý: chọn đúng bot đó", async () => {
      const normal = { isCollectOnly: true };
      const assistant = { isCollectOnly: false };
      const service = makeService({ [normalBot]: normal, [assistantBot]: assistant });
      const dmNormal = (await ensureThread(db, directKey(normalBot, "u-x"), { readMessages: true, captureFiles: false }, "X")).group;
      const dmAssistant = (await ensureThread(db, directKey(assistantBot, "u-y"), { readMessages: true, captureFiles: false }, "Y")).group;
      await assert.rejects(service.runnerForThread(dmNormal), CollectOnlyAccountError);
      assert.equal(await service.runnerForThread(dmAssistant), assistant);
    });

    test("nhắn một người: ưu tiên bot Trợ lý đã có cuộc; người chỉ có cuộc với bot Normal thì dùng bot Trợ lý khác; hết bot Trợ lý thì bỏ việc", async () => {
      const normal = { isCollectOnly: true };
      const assistant = { isCollectOnly: false };
      await ensureThread(db, directKey(normalBot, "u-p"), { readMessages: true, captureFiles: false }, "P");
      const service = makeService({ [normalBot]: normal, [assistantBot]: assistant });
      assert.equal(await service.runnerForUid("u-p"), assistant);
      const onlyNormalService = makeService({ [normalBot]: normal });
      // Bot Trợ lý vẫn bật trong DB (chỉ chưa chạy): lỗi thường để thử lại, KHÔNG bỏ việc
      await assert.rejects(onlyNormalService.runnerForUid("u-p"), (error: Error) => error.name !== "JobSkippedError");
      await db.query("UPDATE bot_account SET is_active = 0 WHERE id = ?", [assistantBot]);
      await assert.rejects(onlyNormalService.runnerForUid("u-p"), (error: Error) => error.name === "JobSkippedError");
    });

    test("ô soạn (admin gửi tay): cuộc chỉ bot Normal bị CollectOnlyAccountError", async () => {
      const service = makeService({ [normalBot]: { isCollectOnly: true }, [assistantBot]: { isCollectOnly: false } });
      await assert.rejects(service.pickRunnerForThread(onlyNormal), CollectOnlyAccountError);
      const picked = await service.pickRunnerForThread(both);
      assert.equal(picked.runner.isCollectOnly, false);
    });

    test("việc gắn tài khoản đã thành Normal: runnerForJob bỏ việc", () => {
      const service = makeService({ [normalBot]: { isCollectOnly: true } });
      assert.throws(() => service.runnerForJob({ payload: { accountId: normalBot } }), CollectOnlyAccountError);
    });
  });

  test("hàm SQL dùng được trong truy vấn danh sách: collect_only trả đúng từng nhóm", async () => {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT g.zalo_group_id, ${collectOnlyThreadSql("g")} AS collect_only FROM zalo_group g WHERE g.thread_type = 1 ORDER BY g.id`);
    assert.deepEqual(rows.map((row) => [row.zalo_group_id, Number(row.collect_only)]), [["g-only", 1], ["g-both", 0], ["g-none", 0]]);
  });
});
