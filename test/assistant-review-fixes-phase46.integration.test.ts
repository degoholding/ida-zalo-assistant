// Vá review phase 4–6 trên MySQL THẬT: cảnh báo / ticket / việc của trợ lý theo phạm vi + Mật, tài khoản web đã tắt không giữ đặc quyền
// vai trò, số liệu theo quyền, thông báo tệp không lộ sự tồn tại, và cờ Mật của recap theo yêu cầu.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { resolveAlertAsker } from "../src/assistant/alert-tools.js";
import { resolveAskerAccess } from "../src/assistant/asker-access.js";
import { canAskInDirectChat } from "../src/assistant/direct-chat-gate.js";
import { runQueryMetricsInTurn } from "../src/assistant/reply-metric-wiring.js";
import type { AssistantRequest } from "../src/assistant/assistant-service.js";
import { assistantChatRoutes } from "../src/web/api/assistant-chat-api.js";
import type { Principal } from "../src/auth/principal.js";
import { currentPrincipal } from "../src/auth/principal.js";
import { Readable } from "node:stream";
import { runTool, type ToolContext } from "../src/assistant/tools.js";
import { AssistantTurnStatus, AttachmentStatus, ContactRole, MeetingRecordingStatus, MessagePriority, ReplyState, TaskSource, TaskStatus, TicketStatus, UserRole } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { findByDriveFileId, insertDiscovered, requeueOndemand } from "../src/meetings/meeting-recording-repository.js";
import { loadSendRequester } from "../src/send-commands/send-target-resolver.js";
import { canIssueSendCommand } from "../src/send-commands/send-command-permissions.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import { ensureGroup, updateGroupSettings } from "../src/sync/group-repository.js";
import { ingestDirectMessage, ingestGroupMessage, type IncomingGroupMessage } from "../src/sync/message-ingest.js";
import { buildTaskContext, runTaskCommand } from "../src/tasks/task-commands.js";
import { buildTicketContext, runTicketCommand } from "../src/tickets/ticket-commands.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["task_event", "task", "ticket_event", "ticket_attachment", "ticket_handler", "ticket", "message_flag", "attachment_text", "attachment",
  "message_search", "message", "group_member", "bot_group", "zalo_group", "contact", "bot_account", "user_group_scope", "app_user", "recipient_group",
  "recipient", "meeting_recording", "audit_log"];
const NOW = new Date("2026-10-01T05:00:00Z");

function incoming(overrides: Partial<IncomingGroupMessage>): IncomingGroupMessage {
  return { zaloGroupId: "g-1", msgId: "1", cliMsgId: "", msgType: "webchat", senderUid: "u-x", senderName: "X", sentAtMs: NOW.getTime() - 3_600_000,
    content: "", quote: null, mentions: null, ...overrides };
}

describe("vá review phase 4–6 (trợ lý)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  const ids: Record<string, number> = {};
  const msgIds: Record<string, number> = {};

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });

  async function addContact(uid: string, role: ContactRole): Promise<number> {
    await db.query("INSERT INTO contact (zalo_uid, display_name, kind, role) VALUES (?, ?, 2, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)", [uid, uid, role]);
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM contact WHERE zalo_uid = ?", [uid]);
    return Number(rows[0].id);
  }
  let userSeq = 0;
  async function addUser(contactId: number, options: { role?: UserRole; confidential?: boolean; active?: boolean; groups?: number[] }): Promise<void> {
    const [result] = await db.query<any>(
      "INSERT INTO app_user (email, username, full_name, role, contact_id, all_groups, can_view_confidential, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [`u${++userSeq}@ida.vn`, `u${userSeq}`, `u${userSeq}`, options.role ?? UserRole.Manager, contactId, options.groups ? 0 : 1,
        options.confidential ? 1 : 0, options.active === false ? 0 : 1]);
    for (const groupId of options.groups ?? []) await db.query("INSERT INTO user_group_scope (user_id, group_id) VALUES (?, ?)", [result.insertId, groupId]);
  }
  async function addFlag(messageId: number, groupId: number): Promise<void> {
    await db.query("INSERT INTO message_flag (message_id, group_id, priority, reply_state, source, reason) VALUES (?, ?, ?, ?, 1, 'khẩn')",
      [messageId, groupId, MessagePriority.Urgent, ReplyState.Waiting]);
  }
  async function addTicket(code: string, threadId: number | null, requesterUid = "u-other"): Promise<number> {
    const [result] = await db.query<any>(
      "INSERT INTO ticket (code, status, title, requester_uid, requester_name, source_thread_id) VALUES (?, ?, ?, ?, 'Khách', ?)",
      [code, TicketStatus.New, `sự cố số ${code.slice(-1)}`, requesterUid, threadId]);
    return result.insertId as number;
  }
  async function toolContext(uid: string, groupScopeId?: number): Promise<ToolContext> {
    const contact = (await findContactByUid(db, uid))!;
    const access = await resolveAskerAccess(db, contact, { groupScopeId, maskPersonal: false, now: NOW });
    const asker = groupScopeId ? null : await resolveAlertAsker(db, contact);
    return {
      db, askerUid: uid, access, filesToSend: [], now: NOW, scopeGroupId: groupScopeId,
      alertTools: { db, config: {} as any, saveSettings: async () => [], invalidate: () => undefined },
      alertAsker: asker ?? undefined, turnStartedAt: Date.now(),
    };
  }
  async function ticketCtx(uid: string, groupScopeId?: number) {
    const contact = (await findContactByUid(db, uid))!;
    let promise: ReturnType<typeof resolveAskerAccess> | null = null;
    return buildTicketContext({ db }, {
      contact: { id: contact.id, uid, name: uid, role: contact.role }, threadId: groupScopeId ?? ids.dmMgr, messageId: null, botAccountId: 1,
      scopeGroupId: groupScopeId, access: () => (promise ??= resolveAskerAccess(db, contact, { groupScopeId, maskPersonal: false, now: NOW })),
    });
  }

  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    const [bot] = await db.query<any>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    const deps = { db, defaults: { readMessages: true, captureFiles: true } };
    for (const [key, zaloId] of [["g1", "g-1"], ["g2", "g-2"], ["gm", "g-mat"]] as const) {
      const { group } = await ensureGroup(db, zaloId, { readMessages: true, captureFiles: true });
      ids[key] = group.id;
    }
    await updateGroupSettings(db, ids.gm, { isConfidential: true });
    await ingestGroupMessage(deps, bot.insertId, incoming({ zaloGroupId: "g-1", msgId: "a", content: "khiếu nại gấp nhóm một" }));
    await ingestGroupMessage(deps, bot.insertId, incoming({ zaloGroupId: "g-2", msgId: "b", content: "khiếu nại gấp nhóm hai" }));
    await ingestGroupMessage(deps, bot.insertId, incoming({ zaloGroupId: "g-mat", msgId: "c", content: "khiếu nại gấp nhóm mật" }));
    for (const [key, text] of [["a", "khiếu nại gấp nhóm một"], ["b", "khiếu nại gấp nhóm hai"], ["c", "khiếu nại gấp nhóm mật"]]) {
      const [rows] = await db.query<RowDataPacket[]>("SELECT id, group_id FROM message WHERE text = ?", [text]);
      msgIds[key] = Number(rows[0].id);
      await addFlag(Number(rows[0].id), Number(rows[0].group_id));
    }
    const dm = await ingestDirectMessage(deps, bot.insertId, incoming({ zaloGroupId: "u-mgr", senderUid: "u-mgr", senderName: "Mgr", msgId: "dm1", content: "tin riêng quản lý" }));
    ids.dmMgr = dm.thread.id;
    const dmOther = await ingestDirectMessage(deps, bot.insertId, incoming({ zaloGroupId: "u-cust", senderUid: "u-cust", senderName: "Khách", msgId: "dm2", content: "tin riêng khách" }));
    ids.dmCust = dmOther.thread.id;
    // Người hỏi: Quản lý chưa có tài khoản; Quản lý có tài khoản không cờ Mật; có cờ Mật; Quản lý bị tắt tài khoản; người nhận chỉ nhóm 1
    await addContact("u-mgr", ContactRole.Manager);
    await addUser(await addContact("u-web", ContactRole.Manager), {});
    await addUser(await addContact("u-flag", ContactRole.Manager), { confidential: true });
    await addUser(await addContact("u-staff", ContactRole.None), { role: UserRole.Staff });
    await addUser(await addContact("u-off", ContactRole.Manager), { active: false });
    const recipient = await addContact("u-rec", ContactRole.None);
    const [rec] = await db.query<any>("INSERT INTO recipient (contact_id, name, is_active, all_groups) VALUES (?, 'Người nhận', 1, 0)", [recipient]);
    await db.query("INSERT INTO recipient_group (recipient_id, group_id) VALUES (?, ?)", [rec.insertId, ids.g1]);
  });

  describe("H1: list_pending_items / mark_item_handled", () => {
    test("người có vai trò (chưa tài khoản) không thấy tin nhóm Mật; người có cờ Mật thấy", async () => {
      const mgr = await runTool(await toolContext("u-mgr"), "list_pending_items", {}) as any;
      assert.deepEqual(mgr.items.map((i: any) => i.message_id).sort(), [msgIds.a, msgIds.b].sort());
      const flag = await runTool(await toolContext("u-flag"), "list_pending_items", {}) as any;
      assert.deepEqual(flag.items.map((i: any) => i.message_id).sort(), [msgIds.a, msgIds.b, msgIds.c].sort());
    });

    test("người nhận chỉ nhóm 1: giao của phạm vi nhóm + Mật — chỉ thấy tin nhóm 1", async () => {
      const rec = await runTool(await toolContext("u-rec"), "list_pending_items", {}) as any;
      assert.deepEqual(rec.items.map((i: any) => i.message_id), [msgIds.a]);
    });

    test("mark_item_handled không chạm tin nhóm Mật khi thiếu cờ, và không đổi DB", async () => {
      const denied = await runTool(await toolContext("u-mgr"), "mark_item_handled", { message_id: msgIds.c }) as any;
      assert.match(denied.error, /Không có tin này/);
      const [rows] = await db.query<RowDataPacket[]>("SELECT reply_state FROM message_flag WHERE message_id = ?", [msgIds.c]);
      assert.equal(Number(rows[0].reply_state), ReplyState.Waiting);
      assert.equal(((await runTool(await toolContext("u-flag"), "mark_item_handled", { message_id: msgIds.c }) as any).ok), true);
    });
  });

  describe("H2: ticket qua trợ lý", () => {
    let t1: number; let t2: number; let t3: number;
    beforeEach(async () => {
      t1 = await addTicket("T-0001", ids.g1);
      t2 = await addTicket("T-0002", ids.gm);
      t3 = await addTicket("T-0003", ids.dmCust, "u-cust");
    });
    const codes = (text: string) => [...text.matchAll(/T-000\d/g)].map((m) => m[0]);

    test("hỏi trong nhóm: list chỉ ticket của nhóm đó", async () => {
      const text = await runTicketCommand(await ticketCtx("u-mgr", ids.g1), { kind: "ticket_list" }, NOW);
      assert.deepEqual(codes(text), ["T-0001"]);
    });

    test("hỏi trong nhóm: xem theo id ticket nhóm khác / tin riêng → không thấy", async () => {
      const ctx = await ticketCtx("u-mgr", ids.g1);
      assert.match(await runTicketCommand(ctx, { kind: "ticket_status", ticketId: t3 }, NOW), /không thấy ticket/);
      assert.match(await runTicketCommand(ctx, { kind: "ticket_status", ticketId: t2 }, NOW), /không thấy ticket/);
      assert.match(await runTicketCommand(ctx, { kind: "ticket_status", ticketId: t1 }, NOW), /T-0001/);
    });

    test("tin riêng: quản lý chưa tài khoản không thấy ticket nhóm Mật (list + id); có cờ Mật thì thấy", async () => {
      const mgr = await ticketCtx("u-mgr");
      assert.deepEqual(codes(await runTicketCommand(mgr, { kind: "ticket_list" }, NOW)).sort(), ["T-0001", "T-0003"]);
      assert.match(await runTicketCommand(mgr, { kind: "ticket_status", ticketId: t2 }, NOW), /không thấy ticket/);
      const flag = await ticketCtx("u-flag");
      assert.deepEqual(codes(await runTicketCommand(flag, { kind: "ticket_list" }, NOW)).sort(), ["T-0001", "T-0002", "T-0003"]);
    });

    test("tài khoản web bị khoanh nhóm 2: không thấy ticket nhóm 1 (cùng luật màn Ticket)", async () => {
      await addUser(await addContact("u-g2", ContactRole.Manager), { groups: [ids.g2] });
      const text = await runTicketCommand(await ticketCtx("u-g2"), { kind: "ticket_list" }, NOW);
      assert.equal(codes(text).length, 0);
    });

    test("người báo vẫn thấy ticket của chính mình ở tin riêng", async () => {
      await addContact("u-cust", ContactRole.None);
      const text = await runTicketCommand(await ticketCtx("u-cust"), { kind: "ticket_list" }, NOW);
      assert.deepEqual(codes(text), ["T-0003"]);
    });

    test("tài khoản web đã tắt: không còn đặc quyền xem ticket người khác từ vai trò", async () => {
      const text = await runTicketCommand(await ticketCtx("u-off"), { kind: "ticket_list" }, NOW);
      assert.equal(codes(text).length, 0);
      assert.match(await runTicketCommand(await ticketCtx("u-off"), { kind: "ticket_status", ticketId: t1 }, NOW), /không thấy ticket/);
    });
  });

  describe("H3: tài khoản web đã tắt", () => {
    test("không dữ liệu nhóm, không Mật, chỉ cuộc riêng của mình", async () => {
      const contact = (await findContactByUid(db, "u-off"))!;
      const access = await resolveAskerAccess(db, contact, { maskPersonal: false });
      assert.equal(access.origin, "disabled_account");
      assert.equal(access.includeConfidential, false);
      const groups = await runTool(await toolContext("u-off"), "list_groups", {}) as any;
      assert.deepEqual((groups.groups ?? []).filter((g: any) => g.id === ids.g1 || g.id === ids.gm), []);
    });

    test("không là người ra lệnh gửi / tắt bot (resolveAlertAsker + loadSendRequester = null)", async () => {
      const contact = (await findContactByUid(db, "u-off"))!;
      assert.equal(await resolveAlertAsker(db, contact), null);
      assert.equal(await loadSendRequester(db, "u-off"), null);
      // Đối chứng: cùng vai trò mà không có tài khoản thì vẫn là người ra lệnh
      const requester = await loadSendRequester(db, "u-mgr");
      assert.ok(requester && canIssueSendCommand(requester));
    });

    test("tài khoản bật lại thì đặc quyền trở lại", async () => {
      await db.query("UPDATE app_user SET is_active = 1 WHERE contact_id = (SELECT id FROM contact WHERE zalo_uid = 'u-off')");
      assert.ok(await loadSendRequester(db, "u-off"));
    });

    test("hai tài khoản đang bật gắn một liên hệ: phạm vi hẹp nhất, không đoán vai trò", async () => {
      const contactId = await addContact("u-dup", ContactRole.Manager);
      await addUser(contactId, { confidential: true });
      await addUser(contactId, { groups: [ids.g1] });
      const access = await resolveAskerAccess(db, (await findContactByUid(db, "u-dup"))!, { maskPersonal: false });
      assert.equal(access.origin, "web_user");
      assert.equal(access.includeConfidential, false);
      assert.ok(access.principal.groupIds && access.principal.groupIds.includes(ids.g1) && !access.principal.groupIds.includes(ids.g2));
    });
  });

  describe("việc (checklist): sếp xem việc người khác", () => {
    async function addTask(code: string, threadId: number): Promise<number> {
      const [result] = await db.query<any>(
        "INSERT INTO task (code, status, title, assignee_uid, assignee_name, assigner_uid, assigner_name, source, source_thread_id) VALUES (?, ?, ?, 'u-z', 'Z', 'u-y', 'Y', ?, ?)",
        [code, TaskStatus.Open, `việc ${code}`, TaskSource.Command, threadId]);
      return result.insertId as number;
    }
    async function taskCtx(uid: string) {
      const contact = (await findContactByUid(db, uid))!;
      let promise: ReturnType<typeof resolveAskerAccess> | null = null;
      return buildTaskContext({ db }, {
        contact: { id: contact.id, uid, name: uid, role: contact.role, kind: 2 }, threadId: ids.dmMgr, messageId: null, groupId: null,
        access: () => (promise ??= resolveAskerAccess(db, contact, { maskPersonal: false, now: NOW })),
      });
    }
    const codes = (text: string | null) => [...String(text).matchAll(/V-000\d/g)].map((m) => m[0]);

    test("danh sách + xem theo id: việc nhóm Mật chỉ hiện với người có quyền Mật", async () => {
      const normal = await addTask("V-0001", ids.g1);
      const secret = await addTask("V-0002", ids.gm);
      const mgr = await taskCtx("u-mgr");
      assert.deepEqual(codes(await runTaskCommand(mgr, { kind: "task_list", scope: "group" }, NOW)), ["V-0001"]);
      assert.match(String(await runTaskCommand(mgr, { kind: "task_status", taskId: secret }, NOW)), /không thấy việc/);
      assert.match(String(await runTaskCommand(mgr, { kind: "task_status", taskId: normal }, NOW)), /V-0001/);
      const flag = await taskCtx("u-flag");
      assert.deepEqual(codes(await runTaskCommand(flag, { kind: "task_list", scope: "group" }, NOW)).sort(), ["V-0001", "V-0002"]);
    });

    test("tài khoản web khoanh nhóm 2 không thấy việc nhóm 1; tài khoản đã tắt không còn là sếp", async () => {
      await addTask("V-0001", ids.g1);
      await addUser(await addContact("u-g2", ContactRole.Manager), { groups: [ids.g2] });
      assert.deepEqual(codes(await runTaskCommand(await taskCtx("u-g2"), { kind: "task_list", scope: "group" }, NOW)), []);
      assert.deepEqual(codes(await runTaskCommand(await taskCtx("u-off"), { kind: "task_list", scope: "group" }, NOW)), []);
    });
  });

  describe("số liệu / tệp / recap", () => {
    test("query_metrics: Nhân viên web + người chỉ là người nhận + tài khoản tắt bị từ chối; người có vai trò chưa tài khoản giữ như cũ", async () => {
      for (const uid of ["u-staff", "u-rec", "u-off"]) {
        const result = await runQueryMetricsInTurn(await toolContext(uid), {}) as any;
        assert.match(result.error, /chưa được cấp quyền xem số liệu/, uid);
      }
      for (const uid of ["u-mgr", "u-web"]) {
        const result = await runQueryMetricsInTurn(await toolContext(uid), {}) as any;
        assert.doesNotMatch(String(result.error ?? ""), /chưa được cấp quyền xem số liệu/, uid);
      }
    });

    test("read_file ở nhóm: tệp của nhóm khác và tệp không có đều báo «Không có tệp này»", async () => {
      const [msg] = await db.query<RowDataPacket[]>("SELECT id FROM message WHERE group_id = ? LIMIT 1", [ids.g2]);
      const [file] = await db.query<any>(
        "INSERT INTO attachment (message_id, group_id, file_name, file_ext, source_url, storage_key, status) VALUES (?, ?, 'x.xlsx', 'xlsx', 'https://f', 'k/x', ?)",
        [msg[0].id, ids.g2, AttachmentStatus.Stored]);
      const context = await toolContext("u-mgr", ids.g1);
      context.readFile = async () => ({ error: "không gọi tới" });
      const other = await runTool(context, "read_file", { attachment_id: file.insertId }) as any;
      const missing = await runTool(context, "read_file", { attachment_id: 999_999 }) as any;
      assert.equal(other.error, "Không có tệp này.");
      assert.equal(missing.error, "Không có tệp này.");
    });

    test("meeting_recording.allow_confidential: ghi / đọc / đặt lại khi xếp hàng lại; mặc định 0 (recap tự động vẫn chặn Mật)", async () => {
      const base = { driveFileId: "f1", fileName: "a.mp3", mime: "audio/mpeg", sizeBytes: 1, driveCreatedAt: NOW, status: MeetingRecordingStatus.Queued, targetThreadId: ids.gm, requesterUid: "u-flag" };
      await insertDiscovered(db, { ...base, driveFileId: "auto" });
      assert.equal((await findByDriveFileId(db, "auto"))!.allowConfidential, false);
      await insertDiscovered(db, { ...base, allowConfidential: true });
      const row = (await findByDriveFileId(db, "f1"))!;
      assert.equal(row.allowConfidential, true);
      await requeueOndemand(db, row.id, { targetThreadId: ids.gm, requesterUid: "u-mgr", allowConfidential: false });
      assert.equal((await findByDriveFileId(db, "f1"))!.allowConfidential, false);
    });
  });
  describe("web «Hỏi trợ lý» (mô phỏng người được chọn)", () => {
    const adminWith = (confidential: boolean): Principal => ({ userId: 1, tenantId: 1, fullName: "Quản trị Web", email: "", role: UserRole.Admin, groupIds: null, canViewConfidential: confidential });

    async function askAsAdmin(admin: Principal, uid: string) {
      const captured: AssistantRequest[] = [];
      const service = {
        db, assistant: { answer: async (request: AssistantRequest) => { captured.push(request); return { text: "ok", attachmentIds: [], status: AssistantTurnStatus.Answered }; } },
      };
      const [, , handler] = assistantChatRoutes.find(([method, pattern]) => method === "POST" && pattern.test("/api/assistant-chat/messages"))!;
      const contact = (await findContactByUid(db, uid))!;
      const request = Readable.from([Buffer.from(JSON.stringify({ contact_id: contact.id, question: "tóm tắt" }))]) as any;
      const response = { writeHead: () => undefined, end: () => undefined } as any;
      await currentPrincipal.run(admin, () => handler({ request, response, url: new URL("http://x/api/assistant-chat/messages"), match: [] as any, service: service as any,
        qrLogins: {} as any, principal: admin, sessions: {} as any }));
      const access = await resolveAskerAccess(db, contact, { maskPersonal: false, now: NOW, webViewer: captured[0].webViewer });
      return { captured: captured[0], access, contact };
    }

    test("Mật = cờ người được chọn VÀ cờ quản trị đang hỏi; không đọc cuộc riêng của người được chọn", async () => {
      const without = await askAsAdmin(adminWith(false), "u-flag");
      assert.equal(without.access.includeConfidential, false, "quản trị không có cờ Mật → không thấy Mật dù người được chọn có cờ");
      const both = await askAsAdmin(adminWith(true), "u-flag");
      assert.equal(both.access.includeConfidential, true);
      // Người được chọn KHÔNG có cờ, quản trị có cờ → vẫn không Mật
      const selectedNoFlag = await askAsAdmin(adminWith(true), "u-web");
      assert.equal(selectedNoFlag.access.includeConfidential, false);
      for (const result of [without, both, selectedNoFlag]) {
        assert.equal(result.access.ownDirectUid, null);
        assert.ok(!(result.access.principal.groupIds ?? []).includes(ids.dmMgr));
      }
    });

    test("công cụ không đọc được cuộc riêng của người được chọn, vẫn thấy nhóm trong phạm vi", async () => {
      const { access } = await askAsAdmin(adminWith(false), "u-mgr");
      const context: ToolContext = { db, askerUid: "u-mgr", access, filesToSend: [], now: NOW };
      const groups = await runTool(context, "list_groups", {}) as any;
      const listed = (groups.groups as { id: number }[]).map((g) => g.id);
      assert.ok(listed.includes(ids.g1));
      assert.ok(!listed.includes(ids.dmMgr), "cuộc riêng của người được chọn không được liệt kê");
      assert.ok(!listed.includes(ids.gm), "nhóm Mật bị ẩn khi quản trị không có cờ");
    });

    test("mỗi lượt hỏi ghi MỘT dòng nhật ký «Hỏi trợ lý thay …», actor = quản trị đang đăng nhập", async () => {
      await db.query("TRUNCATE TABLE audit_log");
      const { contact } = await askAsAdmin(adminWith(false), "u-mgr");
      const [rows] = await db.query<RowDataPacket[]>("SELECT entity, entity_id, action, message, actor FROM audit_log");
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].entity, Number(rows[0].entity_id), rows[0].action, rows[0].message, rows[0].actor], ["contact", contact.id, "assistant_ask", "Hỏi trợ lý thay Mgr", "Quản trị Web"]);
    });
  });
  describe("cổng tin riêng (tài khoản web đang bật là đủ)", () => {
    const gate = async (uid: string, ticketOnly = false) => canAskInDirectChat(db, (await findContactByUid(db, uid))!, uid, ticketOnly);

    test("tài khoản đang bật mà chưa có vai trò Danh bạ / chưa là người nhận → được hỏi; dữ liệu theo phạm vi tài khoản", async () => {
      assert.equal(await gate("u-staff"), true);
      const access = await resolveAskerAccess(db, (await findContactByUid(db, "u-staff"))!, { maskPersonal: false });
      assert.equal(access.origin, "web_user");
    });

    test("giữ nguyên: có vai trò hoặc là người nhận → được; người lạ → không (trừ lệnh ticket / việc)", async () => {
      assert.equal(await gate("u-mgr"), true);
      assert.equal(await gate("u-rec"), true);
      await addContact("u-stranger", ContactRole.None);
      assert.equal(await gate("u-stranger"), false);
      assert.equal(await gate("u-stranger", true), true);
    });

    test("tài khoản đã tắt: vai trò Danh bạ không còn mở cổng; bật lại thì mở lại", async () => {
      assert.equal(await gate("u-off"), false);
      assert.equal(await gate("u-off", true), true, "lệnh ticket / việc vẫn dùng được như người lạ");
      await db.query("UPDATE app_user SET is_active = 1 WHERE contact_id = (SELECT id FROM contact WHERE zalo_uid = 'u-off')");
      assert.equal(await gate("u-off"), true);
    });
  });
});
