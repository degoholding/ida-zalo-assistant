// Phase 5 (N1 — check tin nhắn và cảnh báo) trên MySQL THẬT: phân loại tin mới, báo KHẨN / VIP gộp cho từng người nhận,
// đồng hồ chờ theo giờ làm việc + đóng khi có người trả lời, nhắc tin quá giờ có trần / ngày và giờ yên lặng, AI xét theo lô,
// báo khi phiên Zalo văng, công cụ trợ lý «có gì cần xử lý» + đổi cấu hình hai bước. Zalo, AI, Telegram là bản giả.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { runAiReview } from "../src/alerts/ai-review.js";
import { AlertService } from "../src/alerts/alert-service.js";
import { runReminders } from "../src/alerts/reminders.js";
import { watchSessions } from "../src/alerts/session-watch.js";
import { clearPendingAlertChanges, runAlertTool, type AlertAsker } from "../src/assistant/alert-tools.js";
import { AssistantService } from "../src/assistant/assistant-service.js";
import { parseChatCommand, runChatCommand, type ChatCommandContext } from "../src/assistant/chat-commands.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import type { ModelClient } from "../src/assistant/gemini-client.js";
import type { AppConfig } from "../src/config.js";
import { AlertKind, BotAccountStatus, ContactRole, GroupKind, JobKind, JobStatus, MessagePriority, ReplyState } from "../src/constants.js";
import { DEFAULT_IMPORTANT_KEYWORDS, DEFAULT_STRICT_KEYWORDS, DEFAULT_URGENT_KEYWORDS } from "../src/config.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { buildWorkCalendar } from "../src/schedule/work-calendar.js";
import { ensureGroup } from "../src/sync/group-repository.js";
import { ingestGroupMessage, type IncomingGroupMessage } from "../src/sync/message-ingest.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["system_ai_usage", "alert_log", "alert_cursor", "message_reaction", "message_flag", "job", "assistant_turn", "recipient_vip", "recipient_group", "recipient",
  "attachment", "message", "group_member", "bot_group", "zalo_group", "contact", "bot_account", "audit_log"];
// Thứ 5 08/10/2026, 10:00 giờ VN — trong giờ làm việc
const NOW = new Date("2026-10-08T03:00:00Z");
const calendar = buildWorkCalendar({ workHours: "08:30-12:00, 13:30-17:30", workDays: [1, 2, 3, 4, 5, 6], quietHours: "21:00-06:30", holidays: "" });

function makeConfig(): AppConfig {
  return {
    sessionEncryptionKey: "0".repeat(64),
    assistant: { dailyTokenCap: 1_000_000 },
    privacy: { allowedAiProviders: ["1", "2", "3", "4", "5", "6"] },
    calendar: { workHours: "08:30-12:00, 13:30-17:30", workDays: ["1", "2", "3", "4", "5", "6"], quietHours: "21:00-06:30", holidays: "" },
    alerts: {
      enabled: true, urgentKeywords: DEFAULT_URGENT_KEYWORDS, importantKeywords: DEFAULT_IMPORTANT_KEYWORDS, strictKeywords: DEFAULT_STRICT_KEYWORDS,
      replyWaitMinutes: 120, vipWaitMinutes: 30, dailyReminderCap: 3, urgentMergeSeconds: 120, aiEnabled: true, telegramBotToken: "", telegramChatId: "",
    },
  } as unknown as AppConfig;
}

function message(overrides: Partial<IncomingGroupMessage>): IncomingGroupMessage {
  return {
    zaloGroupId: "g-a", msgId: String(Math.random()).slice(2, 12), cliMsgId: "", msgType: "webchat", senderUid: "u-nv", senderName: "Nhân viên",
    sentAtMs: NOW.getTime() - 60_000, content: "xin chào", quote: null, mentions: null, ...overrides,
  };
}

describe("phase 5 — cảnh báo tin nhắn", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let config: AppConfig;
  let sent: { recipientId: number; text: string }[];
  let alerts: AlertService;
  let groupA: number;
  let groupB: number;
  let tp: number;
  let ceo: number;

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    clearPendingAlertChanges();
    config = makeConfig();
    sent = [];
    await db.query("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    groupA = (await ensureGroup(db, "g-a", { readMessages: true, captureFiles: false })).group.id;
    groupB = (await ensureGroup(db, "g-b", { readMessages: true, captureFiles: false })).group.id;
    await db.query("UPDATE zalo_group SET group_kind = ?, name = 'Bán hàng A' WHERE id = ?", [GroupKind.Internal, groupA]);
    await db.query("UPDATE zalo_group SET group_kind = ?, name = 'Đại lý B' WHERE id = ?", [GroupKind.Customer, groupB]);
    await db.query(`INSERT INTO contact (zalo_uid, display_name, kind, role) VALUES
      ('u-tp', 'Trưởng phòng', 2, ${ContactRole.DepartmentHead}), ('u-ceo', 'CEO', 2, ${ContactRole.Manager}), ('u-vip', 'Đại lý VIP', 1, 0),
      ('u-nv', 'Nhân viên', 2, 0), ('u-khach', 'Khách', 1, 0)`);
    const [contacts] = await db.query<RowDataPacket[]>("SELECT id, zalo_uid FROM contact");
    const cid = (uid: string) => Number(contacts.find((row) => row.zalo_uid === uid)!.id);
    // Trưởng phòng: mọi nhóm, VIP = u-vip. CEO: chỉ nhóm A, không VIP.
    tp = (await db.query<any>("INSERT INTO recipient (contact_id, name, rank_order, all_groups) VALUES (?, 'Trưởng phòng', 1, 1)", [cid("u-tp")]))[0].insertId;
    ceo = (await db.query<any>("INSERT INTO recipient (contact_id, name, rank_order, all_groups) VALUES (?, 'CEO', 2, 0)", [cid("u-ceo")]))[0].insertId;
    await db.query("INSERT INTO recipient_group (recipient_id, group_id) VALUES (?, ?)", [ceo, groupA]);
    await db.query("INSERT INTO recipient_vip (recipient_id, contact_id) VALUES (?, ?)", [tp, cid("u-vip")]);
    alerts = new AlertService(db, config, () => calendar, () => undefined, async (recipientId, text) => { sent.push({ recipientId, text }); });
  });

  async function receive(zaloGroupId: string, overrides: Partial<IncomingGroupMessage>): Promise<number> {
    const incoming = message({ zaloGroupId, ...overrides });
    await ingestGroupMessage({ db, defaults: { readMessages: true, captureFiles: false } }, 1, incoming);
    const [rows] = await db.query<RowDataPacket[]>("SELECT m.id, m.group_id FROM message m WHERE m.zalo_msg_id = ?", [incoming.msgId]);
    await alerts.onNewMessage({ threadId: Number(rows[0].group_id), messageId: Number(rows[0].id) }, NOW);
    return Number(rows[0].id);
  }

  async function dispatchJobs(): Promise<{ recipientId: number }[]> {
    const [rows] = await db.query<RowDataPacket[]>("SELECT payload FROM job WHERE kind = ? AND status = ? ORDER BY id", [JobKind.AlertDispatch, JobStatus.Pending]);
    return rows.map((row) => (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload));
  }

  async function runDispatch(recipientId: number) {
    await alerts.runDispatchJob({ id: 0, kind: JobKind.AlertDispatch, payload: { recipientId }, serialKey: null, attempts: 1, maxAttempts: 3, createdAt: NOW });
  }

  test("urgent messages schedule one merged alert per watching recipient, and are never alerted twice", async () => {
    await receive("g-a", { content: "Đại lý khiếu nại hàng vón cục, xử lý gấp" });
    await receive("g-a", { content: "Thêm một đại lý đòi trả hàng" });
    // Hai tin khẩn, mỗi người nhận theo dõi nhóm A chỉ MỘT lượt báo chờ (gom)
    assert.deepEqual((await dispatchJobs()).map((job) => job.recipientId).sort(), [tp, ceo].sort());
    await runDispatch(tp);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /KHẨN — 2 tin/);
    assert.match(sent[0].text, /Bán hàng A/);
    // Chạy lại: không còn gì để báo
    await runDispatch(tp);
    assert.equal(sent.length, 1);
    const [logRows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM alert_log WHERE recipient_id = ? AND kind = ?", [tp, AlertKind.Urgent]);
    assert.equal(Number(logRows[0].n), 2);
  });

  test("a recipient who does not watch the group is not alerted; a VIP message alerts only the recipient who has that VIP", async () => {
    await receive("g-b", { content: "khiếu nại gấp", senderUid: "u-khach" });
    assert.deepEqual((await dispatchJobs()).map((job) => job.recipientId), [tp]);
    await db.query("DELETE FROM job");
    await receive("g-a", { content: "Anh ơi em gửi đơn tuần này", senderUid: "u-vip", senderName: "Đại lý VIP" });
    assert.deepEqual((await dispatchJobs()).map((job) => job.recipientId), [tp]);
    await runDispatch(ceo);
    assert.equal(sent.length, 0);
  });

  test("strict words wait for AI: no alert until the batch review says it is urgent", async () => {
    const id = await receive("g-a", { content: "Khách la quá trời luôn anh ơi, số khách 0912345678" });
    assert.deepEqual(await dispatchJobs(), []);
    const [flag] = await db.query<RowDataPacket[]>("SELECT priority, pending_ai FROM message_flag WHERE message_id = ?", [id]);
    assert.deepEqual([Number(flag[0].priority), Number(flag[0].pending_ai)], [MessagePriority.Normal, 1]);
    const model: ModelClient = {
      generate: async (request) => {
        assert.doesNotMatch(JSON.stringify(request.contents), /0912345678/);
        return { content: { role: "model", parts: [{ text: `[{"id": ${id}, "muc": "khan", "ly_do": "khách giận"}]` }] }, inputTokens: 500, outputTokens: 30 };
      },
    };
    const result = await runAiReview(db, config, NOW, model);
    assert.equal(result.urgent, 1);
    assert.equal((await dispatchJobs()).length, 2);
    const [after] = await db.query<RowDataPacket[]>("SELECT priority, pending_ai, reason FROM message_flag WHERE message_id = ?", [id]);
    assert.deepEqual([Number(after[0].priority), Number(after[0].pending_ai)], [MessagePriority.Urgent, 0]);
    // Token của lượt AI tính vào trần ngày
    const [usage] = await db.query<RowDataPacket[]>("SELECT input_tokens, item_count FROM system_ai_usage WHERE purpose = 'alert-review'");
    assert.deepEqual([Number(usage[0].input_tokens), Number(usage[0].item_count)], [500, 1]);
    // Chạm trần token ngày thì lượt sau không gọi AI
    config.assistant.dailyTokenCap = 100;
    await receive("g-a", { content: "Khách đòi giao liền trong chiều nay" });
    assert.equal((await runAiReview(db, config, NOW, model)).skipped, "chạm trần token ngày");
  });

  test("the AI review never sends a confidential group's messages to the model", async () => {
    await db.query("UPDATE zalo_group SET is_confidential = 1 WHERE id = ?", [groupA]);
    await receive("g-a", { content: "Bàn về lương thưởng tháng này của phòng" });
    let called = false;
    const model: ModelClient = { generate: async () => { called = true; return { content: { role: "model", parts: [{ text: "[]" }] }, inputTokens: 1, outputTokens: 1 }; } };
    await runAiReview(db, config, NOW, model);
    assert.equal(called, false);
  });

  test("mentioning a recipient starts a working-hours clock that a quoted reply closes", async () => {
    const asked = await receive("g-a", { content: "@Trưởng phòng duyệt giúp em đơn này", mentions: [{ uid: "u-tp", pos: 0, len: 13 }] });
    const [flag] = await db.query<RowDataPacket[]>("SELECT reply_state, for_uid, due_at FROM message_flag WHERE message_id = ?", [asked]);
    assert.equal(Number(flag[0].reply_state), ReplyState.Waiting);
    assert.equal(flag[0].for_uid, "u-tp");
    // 09:59 + 120 phút làm việc = 11:59 cùng buổi sáng
    assert.equal(new Date(flag[0].due_at).toISOString(), "2026-10-08T04:59:00.000Z");
    const [zalo] = await db.query<RowDataPacket[]>("SELECT zalo_msg_id FROM message WHERE id = ?", [asked]);
    await receive("g-a", { senderUid: "u-tp", senderName: "Trưởng phòng", content: "ok duyệt", quote: { globalMsgId: zalo[0].zalo_msg_id, msg: "", ownerUid: "u-nv" } });
    const [after] = await db.query<RowDataPacket[]>("SELECT reply_state, handled_by_uid FROM message_flag WHERE message_id = ?", [asked]);
    assert.deepEqual([Number(after[0].reply_state), after[0].handled_by_uid], [ReplyState.Handled, "u-tp"]);
  });

  test("old messages (history import / reconnect backfill) are never classified", async () => {
    await receive("g-a", { content: "khiếu nại gấp", sentAtMs: NOW.getTime() - 60 * 60_000 });
    const [flags] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM message_flag");
    assert.equal(Number(flags[0].n), 0);
  });

  test("overdue reminders respect the daily cap, quiet hours and the recipient's scope", async () => {
    for (let n = 0; n < 5; n += 1) {
      const id = await receive("g-b", { senderUid: "u-khach", senderName: "Khách", content: `Đơn số ${n} giao chưa vậy?` });
      await db.query("UPDATE message_flag SET due_at = ? WHERE message_id = ?", [new Date(NOW.getTime() - 60_000), id]);
      // Mỗi vòng nhắc chỉ một lần cho một tin — muốn có nhiều lần nhắc thì mỗi lần một tin quá hạn mới
      assert.equal(await runReminders(db, config, calendar, new Date(NOW.getTime() + n * 60_000)), n < 3 ? 1 : 0);
    }
    const [jobs] = await db.query<RowDataPacket[]>("SELECT payload FROM job WHERE kind = ?", [JobKind.RecipientMessage]);
    const recipients = jobs.map((row) => (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload).recipientId);
    // Nhóm B (khách) chỉ Trưởng phòng theo dõi; trần 3 lần / ngày
    assert.deepEqual(recipients, [tp, tp, tp]);
    // Giờ yên lặng (22:00 VN) không nhắc
    await db.query("DELETE FROM alert_log");
    assert.equal(await runReminders(db, config, calendar, new Date("2026-10-08T15:00:00Z")), 0);
  });

  test("a session that stops beating is reported once, and its recovery once", async () => {
    const messages: string[] = [];
    const send = async (text: string) => { messages.push(text); };
    await db.query("UPDATE bot_account SET status = ?, last_heartbeat_at = ?", [BotAccountStatus.Connected, new Date(NOW.getTime() - 10 * 60_000)]);
    assert.deepEqual(await watchSessions(db, send, NOW), { down: 1, recovered: 0 });
    assert.deepEqual(await watchSessions(db, send, NOW), { down: 0, recovered: 0 });
    await db.query("UPDATE bot_account SET last_heartbeat_at = ?", [NOW]);
    assert.deepEqual(await watchSessions(db, send, NOW), { down: 0, recovered: 1 });
    assert.equal(messages.length, 2);
    assert.match(messages[0], /MẤT KẾT NỐI/);
  });

  test("assistant tools: pending list in scope, mark handled, and config changes need a confirmation in a LATER turn", async () => {
    await receive("g-a", { content: "khiếu nại gấp về lô hàng" });
    const saved: Record<string, unknown>[] = [];
    const deps = { db, config, saveSettings: async (patch: Record<string, unknown>) => { saved.push(patch); return Object.keys(patch); }, invalidate: () => undefined };
    const ceoAsker: AlertAsker = { uid: "u-ceo", name: "CEO", role: ContactRole.Manager, recipientId: ceo };
    const list = await runAlertTool(deps, ceoAsker, "list_pending_items", {}, NOW, Date.now()) as any;
    assert.equal(list.count, 1);
    assert.equal(list.items[0].muc, "KHẨN");
    assert.equal((await runAlertTool(deps, ceoAsker, "mark_item_handled", { message_id: list.items[0].message_id }, NOW, Date.now()) as any).ok, true);
    assert.equal((await runAlertTool(deps, ceoAsker, "list_pending_items", {}, NOW, Date.now()) as any).count, 0);

    const turn1 = Date.now();
    const proposal = await runAlertTool(deps, ceoAsker, "propose_alert_change", { action: "add_urgent_keyword", keyword: "Bể bao" }, NOW, turn1) as any;
    assert.match(proposal.preview, /«bể bao»/);
    // Cùng lượt: tự xác nhận bị chặn
    assert.match((await runAlertTool(deps, ceoAsker, "confirm_alert_change", { change_id: proposal.change_id }, NOW, turn1) as any).error, /tin sau/);
    assert.equal(saved.length, 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const done = await runAlertTool(deps, ceoAsker, "confirm_alert_change", { change_id: proposal.change_id }, NOW, Date.now()) as any;
    assert.equal(done.ok, true);
    assert.match(String(saved[0].alert_urgent_keywords), /bể bao/);
    // Người khác không xác nhận hộ được; người không phải quản lý không đổi từ khóa chung được
    const staff: AlertAsker = { uid: "u-nv", name: "NV", role: ContactRole.None, recipientId: tp };
    assert.match((await runAlertTool(deps, staff, "propose_alert_change", { action: "add_urgent_keyword", keyword: "x" }, NOW, Date.now()) as any).error, /Quản lý/);
    // VIP: chỉ của chính người nhận
    const vipProposal = await runAlertTool(deps, staff, "propose_alert_change", { action: "add_vip", person_uid: "u-khach" }, NOW, Date.now()) as any;
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match((await runAlertTool(deps, ceoAsker, "confirm_alert_change", { change_id: vipProposal.change_id }, NOW, Date.now()) as any).error, /Không có đề xuất/);
    assert.equal((await runAlertTool(deps, staff, "confirm_alert_change", { change_id: vipProposal.change_id }, NOW, Date.now()) as any).ok, true);
    const [vips] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM recipient_vip WHERE recipient_id = ?", [tp]);
    assert.equal(Number(vips[0].n), 2);
  });
  test("typed commands: help, config, pending list, keyword change confirmed by «đồng ý», cancel, VIP by name", async () => {
    await receive("g-a", { content: "khiếu nại gấp về lô hàng" });
    const saved: Record<string, unknown>[] = [];
    const deps = { db, config, saveSettings: async (patch: Record<string, unknown>) => { saved.push(patch); return Object.keys(patch); }, invalidate: () => undefined };
    const ceoAsker: AlertAsker = { uid: "u-ceo", name: "CEO", role: ContactRole.Manager, recipientId: ceo };
    const tpAsker: AlertAsker = { uid: "u-tp", name: "Trưởng phòng", role: ContactRole.DepartmentHead, recipientId: tp };
    const ctx = (asker: AlertAsker | null): ChatCommandContext => ({ db, alertTools: deps, asker, inGroup: false, now: NOW });
    const say = async (asker: AlertAsker | null, text: string) => {
      const command = parseChatCommand(text);
      return command ? runChatCommand(ctx(asker), command) : null;
    };

    assert.match(String(await say(ceoAsker, "hướng dẫn tôi")), /thêm từ khẩn/);
    const configText = String(await say(tpAsker, "cấu hình"));
    assert.match(configText, /Từ KHẨN: .*khiếu nại/);
    assert.match(configText, /Nhóm theo dõi: tất cả các nhóm/);
    assert.match(configText, /VIP: Đại lý VIP/);

    const pendingText = String(await say(ceoAsker, "cần xử lý"));
    const id = Number(pendingText.match(/#(\d+) \[KHẨN\]/)?.[1]);
    assert.ok(id > 0, pendingText);
    assert.match(String(await say(ceoAsker, `xong ${id}`)), /Đã đánh dấu xong/);
    assert.match(String(await say(ceoAsker, "can xu ly")), /không có tin nào/);

    // «ok» khi KHÔNG có đề xuất chờ = câu nói thường, để AI trả lời
    assert.equal(await say(ceoAsker, "ok"), null);
    assert.match(String(await say(ceoAsker, "thêm từ khẩn Bể Bao")), /Thêm từ khóa KHẨN «bể bao»[\s\S]*đồng ý/);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(String(await say(ceoAsker, "đồng ý")), /Đã đổi/);
    assert.match(String(saved[0].alert_urgent_keywords), /bể bao/);
    // Không còn đề xuất chờ: «đồng ý» lần nữa không đổi gì
    assert.equal(await say(ceoAsker, "đồng ý"), null);

    assert.match(String(await say(ceoAsker, "phút chờ 90")), /90 phút/);
    assert.match(String(await say(ceoAsker, "hủy")), /đã bỏ/);
    assert.equal(saved.length, 1);
    assert.match(String(await say(ceoAsker, "bỏ từ khẩn không có từ này")), /không có/);
    assert.match(String(await say(ceoAsker, "phút chờ 3")), /từ 10 đến 2880/);

    // Trưởng phòng không là quản lý chung? — có (DepartmentHead đổi được); người không vai trò thì không
    const staff: AlertAsker = { uid: "u-nv", name: "NV", role: ContactRole.None, recipientId: tp };
    assert.match(String(await say(staff, "thêm từ khẩn abc")), /Quản lý \/ Trưởng phòng/);
    assert.match(String(await say(null, "cấu hình") ?? "AI"), /AI/);
    assert.match(String(await say(null, "thêm từ khẩn abc")), /dành cho quản lý/);

    // VIP theo tên: khớp không dấu, một người thì đề xuất luôn
    await db.query("INSERT INTO contact (zalo_uid, display_name, kind, role) VALUES ('u-np1', 'Nguyễn Phát', 1, 0), ('u-np2', 'Trần Phát', 1, 0)");
    assert.match(String(await say(tpAsker, "them vip phat")), /Có 2 người khớp/);
    assert.match(String(await say(tpAsker, "thêm vip nguyen phat")), /Thêm «Nguyễn Phát» vào danh sách VIP/);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(String(await say(tpAsker, "ok")), /Đã đổi/);
    assert.match(String(await say(tpAsker, "bỏ vip trần phát")), /không có ai/);
    assert.match(String(await say(ceoAsker, "thêm vip nguyen phat")), /Thêm «Nguyễn Phát»/);
  });

  test("the assistant answers typed commands without calling the model, even past the daily token cap", async () => {
    const model: ModelClient = { generate: async () => { throw new Error("không được gọi mô hình cho lệnh"); } };
    const deps = { db, config, saveSettings: async () => [], invalidate: () => undefined };
    const assistant = new AssistantService(db, model, "m", { maxPerHour: 30, dailyTokenCap: 0 }, () => NOW, { alertTools: deps });
    const contact = (await findContactByUid(db, "u-ceo"))!;
    const reply = await assistant.answer({ botAccountId: 1, contact, threadId: groupA, questionMessageId: null, question: "Hướng dẫn" });
    assert.match(String(reply.text), /HƯỚNG DẪN/);
    assert.match(String(reply.text), /thêm từ khẩn/);
    const inGroup = await assistant.answer({ botAccountId: 1, contact, threadId: groupA, questionMessageId: null, question: "huong dan",
      groupScope: { groupId: groupA, groupName: "Bán hàng A" } });
    assert.match(String(inGroup.text), /TRONG NHÓM/);
    const [turns] = await db.query<RowDataPacket[]>("SELECT model, input_tokens FROM assistant_turn ORDER BY id");
    assert.deepEqual(turns.map((row) => [row.model, Number(row.input_tokens)]), [["lệnh", 0], ["lệnh", 0]]);
  });
  test("web search: the separate search service is used first and falls back to the model's own search when it is out of quota", async () => {
    const { WebSearchUnavailableError } = await import("../src/assistant/gemini-client.js");
    const answers: string[] = [];
    const model = (withOwnSearch: boolean): ModelClient => ({
      generate: async (request) => {
        const last = request.contents[request.contents.length - 1];
        const response = last.parts.find((part) => part.functionResponse)?.functionResponse?.response as { answer?: string; error?: string } | undefined;
        if (response) {
          answers.push(String(response.answer ?? response.error));
          return { content: { role: "model", parts: [{ text: "xong" }] }, inputTokens: 1, outputTokens: 1 };
        }
        assert.ok(request.tools.some((tool) => tool.name === "web_search"));
        return { content: { role: "model", parts: [{ functionCall: { name: "web_search", args: { query: "giá vàng hôm nay" } } }] }, inputTokens: 1, outputTokens: 1 };
      },
      ...(withOwnSearch ? { searchWeb: async () => ({ text: "từ Gemini", sources: [], inputTokens: 0, outputTokens: 0 }) } : {}),
    });
    const contact = (await findContactByUid(db, "u-ceo"))!;
    const ask = (client: ModelClient, webSearch: (q: string) => Promise<never | { text: string; sources: never[]; inputTokens: number; outputTokens: number }>) =>
      new AssistantService(db, client, "m", { maxPerHour: 30, dailyTokenCap: 1_000_000 }, () => NOW, { webSearch })
        .answer({ botAccountId: 1, contact, threadId: groupA, questionMessageId: null, question: "giá vàng hôm nay bao nhiêu" });
    await ask(model(true), async () => ({ text: "từ Tavily", sources: [], inputTokens: 0, outputTokens: 0 }));
    await ask(model(true), async () => { throw new WebSearchUnavailableError("Tavily 432"); });
    await ask(model(false), async () => { throw new WebSearchUnavailableError("Tavily 432"); });
    assert.equal(answers[0], "từ Tavily");
    assert.equal(answers[1], "từ Gemini");
    assert.match(answers[2], /tạm không dùng được/);
  });
});
