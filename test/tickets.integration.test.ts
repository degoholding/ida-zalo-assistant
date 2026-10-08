// Ticket qua bot (08/10/2026) trên MySQL THẬT: báo ticket kèm ảnh vừa gửi, báo người xử lý, nhận / xong / bổ sung (mở lại) /
// hủy trên Zalo, ai được làm gì, báo lại người gửi đúng chỗ (tin riêng / nhóm), và màn Ticket trên web (quyền + thao tác).
// Tin Zalo thật không gửi — kiểm các việc ContactMessage nằm trong hàng đợi.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import type http from "node:http";
import { PassThrough } from "node:stream";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { parseChatCommand, runChatCommand } from "../src/assistant/chat-commands.js";
import { SessionStore } from "../src/auth/session-store.js";
import { ensureAdminUser, setUserPassword } from "../src/auth/user-admin.js";
import { AttachmentStatus, JobKind, TicketStatus } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { directKey, ensureGroup, ensureThread } from "../src/sync/group-repository.js";
import { ingestGroupMessage, type IncomingGroupMessage } from "../src/sync/message-ingest.js";
import { buildTicketContext } from "../src/tickets/ticket-commands.js";
import { findTicket, type ContactMessagePayload, type TicketDeps } from "../src/tickets/ticket-service.js";
import { handleApiRequest, type ApiDeps } from "../src/web/api/api-router.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["ticket_event", "ticket_attachment", "ticket_handler", "ticket", "job", "attachment", "message", "group_member", "bot_group",
  "zalo_group", "contact", "bot_account", "audit_log", "web_session", "app_user"];
const NOW = new Date("2026-10-08T03:00:00Z");

function message(overrides: Partial<IncomingGroupMessage>): IncomingGroupMessage {
  return {
    zaloGroupId: "g-kho", msgId: String(Math.random()).slice(2, 12), cliMsgId: "", msgType: "webchat", senderUid: "u-lan", senderName: "Lan",
    sentAtMs: NOW.getTime() - 60_000, content: "xin chào", quote: null, mentions: null, ...overrides,
  };
}

describe("ticket qua bot", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let deps: TicketDeps;
  let downloads: number[];
  let dmThread: number;
  let groupThread: number;
  const contactIds: Record<string, number> = {};

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    downloads = [];
    deps = { db, requestDownload: (ids) => downloads.push(...ids) };
    await db.query("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    await db.query(`INSERT INTO contact (zalo_uid, display_name, kind, role) VALUES
      ('u-lan', 'Lan', 2, 0), ('u-it1', 'Hùng IT', 2, 0), ('u-it2', 'Minh IT', 2, 0), ('u-binh', 'Bình', 2, 0)`);
    const [contacts] = await db.query<RowDataPacket[]>("SELECT id, zalo_uid FROM contact");
    for (const row of contacts) contactIds[String(row.zalo_uid)] = Number(row.id);
    await db.query("INSERT INTO ticket_handler (contact_id) VALUES (?), (?)", [contactIds["u-it1"], contactIds["u-it2"]]);
    dmThread = (await ensureThread(db, directKey(1, "u-lan"), { readMessages: true, captureFiles: true }, "Lan")).group.id;
    groupThread = (await ensureGroup(db, "g-kho", { readMessages: true, captureFiles: false })).group.id;
    await db.query("UPDATE zalo_group SET name = 'Kho Cần Thơ' WHERE id = ?", [groupThread]);
  });

  /** Một tin vào cuộc (riêng / nhóm); trả id tin. */
  async function receive(threadId: number, overrides: Partial<IncomingGroupMessage>): Promise<number> {
    const [threads] = await db.query<RowDataPacket[]>("SELECT zalo_group_id FROM zalo_group WHERE id = ?", [threadId]);
    const incoming = message({ zaloGroupId: String(threads[0].zalo_group_id), ...overrides });
    if (threadId === dmThread) {
      // Tin riêng: chèn thẳng vào cuộc riêng đã có (ingestDirectMessage cần phiên bot — không cần ở đây)
      const [result] = await db.query<any>(
        "INSERT INTO message (group_id, zalo_msg_id, kind, sender_uid, sender_name, sent_at, text) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [threadId, incoming.msgId, overrides.msgType === "chat.photo" ? 2 : 1, incoming.senderUid, incoming.senderName, new Date(incoming.sentAtMs),
          typeof incoming.content === "string" ? incoming.content : null]);
      if (overrides.msgType === "chat.photo") {
        await db.query("INSERT INTO attachment (message_id, group_id, file_name, file_ext, source_url, status) VALUES (?, ?, '', 'jpg', 'https://p', ?)",
          [result.insertId, threadId, AttachmentStatus.Stored]);
      }
      return result.insertId;
    }
    await ingestGroupMessage({ db, defaults: { readMessages: true, captureFiles: false } }, 1, incoming);
    const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM message WHERE zalo_msg_id = ?", [incoming.msgId]);
    return Number(rows[0].id);
  }

  async function say(uid: string, threadId: number, text: string, messageId: number | null = null, inGroup = false) {
    const command = parseChatCommand(text);
    assert.ok(command, `không đọc được lệnh: ${text}`);
    const names: Record<string, string> = { "u-lan": "Lan", "u-it1": "Hùng IT", "u-it2": "Minh IT", "u-binh": "Bình" };
    const ticket = buildTicketContext(deps, { contact: { id: contactIds[uid], uid, name: names[uid] }, threadId, messageId, botAccountId: 1 });
    return String(await runChatCommand({ db, asker: null, inGroup, now: NOW, ticket, ticketOnly: !inGroup }, command));
  }

  async function sayAs(uid: string, role: number, text: string) {
    const command = parseChatCommand(text);
    assert.ok(command, `không đọc được lệnh: ${text}`);
    const ticket = buildTicketContext(deps, { contact: { id: contactIds[uid], uid, name: uid, role }, threadId: dmThread, messageId: null, botAccountId: 1 });
    return String(await runChatCommand({ db, asker: null, inGroup: false, now: NOW, ticket }, command));
  }

  async function messages(): Promise<(ContactMessagePayload & { runAfter: Date })[]> {
    const [rows] = await db.query<RowDataPacket[]>("SELECT payload, run_after FROM job WHERE kind = ? ORDER BY id", [JobKind.ContactMessage]);
    return rows.map((row) => ({ ...(typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload), runAfter: new Date(row.run_after) }));
  }

  test("reporting in a DM attaches the photos just sent, notifies every handler (text, then photos), and answers with the code", async () => {
    await receive(dmThread, { msgType: "chat.photo", content: { href: "https://p/1.jpg" }, sentAtMs: NOW.getTime() - 5 * 60_000 });
    await receive(dmThread, { msgType: "chat.photo", content: { href: "https://p/2.jpg" }, sentAtMs: NOW.getTime() - 2 * 60_000 });
    // Ảnh cũ hơn 15 phút và ảnh của người khác không gắn
    await receive(dmThread, { msgType: "chat.photo", content: { href: "https://p/old.jpg" }, sentAtMs: NOW.getTime() - 40 * 60_000 });
    await receive(dmThread, { msgType: "chat.photo", senderUid: "u-binh", content: { href: "https://p/b.jpg" }, sentAtMs: NOW.getTime() - 60_000 });
    const asked = await receive(dmThread, { content: "Báo lỗi: máy in kho kẹt giấy" });
    const reply = await say("u-lan", dmThread, "Báo lỗi: máy in kho kẹt giấy\nđã thử tắt mở", asked);
    assert.match(reply, /T-0001 \(kèm 2 ảnh/);
    const ticket = (await findTicket(db, 1))!;
    assert.deepEqual([ticket.status, ticket.title, ticket.requester_name], [TicketStatus.New, "máy in kho kẹt giấy", "Lan"]);
    const sent = await messages();
    // Mỗi người xử lý: một tin chữ ngay + một tin ảnh sau 30 giây
    assert.deepEqual(sent.map((item) => [item.zaloUid, Boolean(item.text), item.attachmentIds?.length ?? 0]).sort(),
      [["u-it1", false, 2], ["u-it1", true, 0], ["u-it2", false, 2], ["u-it2", true, 0]]);
    assert.match(sent.find((item) => item.text)!.text!, /TICKET MỚI T-0001[\s\S]*tin riêng[\s\S]*nhận T-1/);
  });

  test("photos from a group that does not keep files are re-queued for download", async () => {
    const photo = await receive(groupThread, { msgType: "chat.photo", content: { href: "https://p/g.jpg", params: "{}" } });
    const [before] = await db.query<RowDataPacket[]>("SELECT id, status FROM attachment WHERE message_id = ?", [photo]);
    assert.equal(Number(before[0].status), AttachmentStatus.Skipped);
    const asked = await receive(groupThread, { content: "@bot báo lỗi: xe nâng hỏng" });
    assert.match(await say("u-lan", groupThread, "báo lỗi: xe nâng hỏng", asked, true), /T-0001 \(kèm 1 ảnh/);
    const [afterRows] = await db.query<RowDataPacket[]>("SELECT status FROM attachment WHERE id = ?", [before[0].id]);
    assert.equal(Number(afterRows[0].status), AttachmentStatus.Pending);
    assert.deepEqual(downloads, [Number(before[0].id)]);
    assert.match((await messages())[0].text!, /nhóm «Kho Cần Thơ»/);
  });

  test("only handlers accept / finish; the requester is told where they reported, other handlers learn who took it", async () => {
    await say("u-lan", groupThread, "báo lỗi: wifi kho yếu", null, true);
    await db.query("DELETE FROM job");
    assert.match(await say("u-lan", dmThread, "nhận T-1"), /Chỉ người xử lý/);
    assert.match(await say("u-binh", dmThread, "T-1"), /không thấy ticket T-1/);
    assert.match(await say("u-it1", dmThread, "nhận T-1"), /đã nhận T-0001/);
    let sent = await messages();
    const toRequester = sent.find((item) => item.threadId === groupThread)!;
    assert.match(toRequester.text!, /^Lan ơi, ticket T-0001 «wifi kho yếu» đã được Hùng IT nhận/);
    assert.deepEqual(sent.filter((item) => item.zaloUid).map((item) => item.zaloUid), ["u-it2"]);
    assert.match(await say("u-it1", dmThread, "nhận T-1"), /đã nhận T-0001 rồi/);
    assert.match(await say("u-lan", dmThread, "T-1 sao rồi"), /đang xử lý — người xử lý: Hùng IT/);

    await db.query("DELETE FROM job");
    assert.match(await say("u-it1", dmThread, "xong T-1 đã đổi router"), /Dạ đã đóng T-0001/);
    sent = await messages();
    assert.match(sent[0].text!, /đã xử lý xong \(Hùng IT\)\.\nGhi chú: đã đổi router/);
    assert.match(await say("u-it2", dmThread, "xong T-1"), /đã xong rồi/);
  });

  test("a requester adding to a finished ticket reopens it and only the assigned handler is told", async () => {
    await say("u-lan", dmThread, "báo lỗi: máy tính chậm");
    await say("u-it2", dmThread, "nhận T-1");
    await say("u-it2", dmThread, "xong T-1");
    await db.query("DELETE FROM job");
    assert.match(await say("u-lan", dmThread, "T-1: vẫn còn chậm anh ơi"), /MỞ LẠI/);
    const ticket = (await findTicket(db, 1))!;
    assert.equal(ticket.status, TicketStatus.InProgress);
    assert.deepEqual((await messages()).map((item) => item.zaloUid), ["u-it2"]);
    // Người xử lý nhắn lại → về người gửi
    await db.query("DELETE FROM job");
    assert.match(await say("u-it2", dmThread, "T-1: anh qua kiểm lúc 2h"), /chuyển lời nhắn tới Lan/);
    assert.equal((await messages())[0].threadId, dmThread);
  });

  test("lists: a handler sees open tickets, a requester sees their own; a requester may cancel their own", async () => {
    await say("u-lan", dmThread, "báo lỗi: một");
    await say("u-binh", dmThread, "báo lỗi: hai");
    assert.match(await say("u-it1", dmThread, "ticket"), /TICKET ĐANG MỞ \(2\)/);
    const mine = await say("u-lan", dmThread, "ticket của tôi");
    assert.match(mine, /T-0001/);
    assert.doesNotMatch(mine, /T-0002/);
    await db.query("DELETE FROM job");
    assert.match(await say("u-lan", dmThread, "hủy T-1 báo nhầm"), /đã hủy T-0001/);
    assert.equal((await findTicket(db, 1))!.status, TicketStatus.Cancelled);
    // Chưa ai nhận: mọi người xử lý đã nhận tin «TICKET MỚI» nên đều được báo hủy
    assert.deepEqual((await messages()).map((item) => item.zaloUid).sort(), ["u-it1", "u-it2"]);
    assert.match(await say("u-lan", dmThread, "hủy T-2"), /không thấy ticket T-2/);
  });

  test("a requester may close their own ticket («báo xử lý xong T1»); a manager sees every open ticket but cannot close others'", async () => {
    await say("u-lan", dmThread, "báo lỗi: một");
    await say("u-binh", dmThread, "báo lỗi: hai");
    await db.query("UPDATE contact SET role = 2 WHERE zalo_uid = 'u-binh'");
    await db.query("DELETE FROM job");
    assert.match(await say("u-lan", dmThread, "báo xử lý xong T1"), /đã đóng T-0001 theo báo/);
    const closed = (await findTicket(db, 1))!;
    assert.deepEqual([closed.status, closed.handler_name, closed.resolution], [TicketStatus.Done, "", "Người gửi báo đã xong"]);
    // Chưa ai nhận → mọi người xử lý được báo; người gửi không bị báo lại
    assert.deepEqual((await messages()).map((item) => item.zaloUid).sort(), ["u-it1", "u-it2"]);
    assert.match(await sayAs("u-binh", 2, "hiện tại có bao nhiêu ticket"), /TICKET ĐANG MỞ \(1\)/);
    assert.match(await sayAs("u-binh", 2, "T-1"), /T-0001/);
    assert.match(await sayAs("u-binh", 2, "xong T-1"), /đã xong rồi|Chỉ người xử lý/);
    // T-2 là của chính u-binh nên đóng được; thử đóng ticket người khác đang mở
    await say("u-lan", dmThread, "báo lỗi: thứ ba");
    assert.match(await sayAs("u-binh", 2, "xong T-3"), /Chỉ người xử lý ticket \(hoặc chính người báo\)/);
  });

  test("with no handler configured the ticket is still saved and the requester is told", async () => {
    await db.query("DELETE FROM ticket_handler");
    assert.match(await say("u-lan", dmThread, "báo lỗi: điện chập chờn"), /chưa cài người xử lý/);
    assert.ok(await findTicket(db, 1));
  });

  describe("màn Ticket trên web", () => {
    let apiDeps: ApiDeps;
    before(() => {
      const service = { db, config: { google: { loginClientId: "" }, privacy: { allowedAiProviders: ["1"] } }, jobs: { wake: () => undefined },
        alerts: { invalidate: () => undefined }, get tickets() { return deps; } };
      apiDeps = { service: service as unknown as ApiDeps["service"], sessions: new SessionStore(db), qrLogins: {} as ApiDeps["qrLogins"] };
    });

    async function call(method: string, path: string, body?: unknown, token?: string) {
      const request = new PassThrough() as unknown as http.IncomingMessage & PassThrough;
      Object.assign(request, { method, url: path, headers: { host: "localhost" } });
      (request as unknown as PassThrough).end(body === undefined ? undefined : JSON.stringify(body));
      let status = 200;
      let raw = "";
      const response = {
        headersSent: false, setHeader: () => undefined, writeHead: (code: number) => { status = code; return response; },
        end: (chunk?: string) => { raw = chunk ?? ""; }, write: () => true, on: () => response, destroy: () => undefined,
      } as unknown as http.ServerResponse;
      await handleApiRequest({ request, response, url: new URL(path, "http://localhost") }, apiDeps, { token, clientKey: "t", setCookie: (v) => `s=${v}` });
      return { status, body: raw ? JSON.parse(raw) : null };
    }

    async function login(username: string, password: string, role?: number): Promise<string> {
      if (role) {
        await db.query("INSERT INTO app_user (username, email, full_name, role, is_active) VALUES (?, ?, ?, ?, 1)", [username, `${username}@ida.vn`, username, role]);
        await setUserPassword(db, username, password);
      } else {
        await ensureAdminUser(db, username, password);
      }
      apiDeps = { ...apiDeps, sessions: new SessionStore(db) };
      const request = await call("POST", "/api/auth/login", { username, password });
      assert.equal(request.status, 200, JSON.stringify(request.body));
      const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM app_user WHERE username = ?", [username]);
      // Phiên lấy thẳng từ kho phiên (cookie trong bài kiểm không đọc lại được)
      return apiDeps.sessions.create(Number(rows[0].id));
    }

    test("list + detail + accept from the web notifies the requester; staff may read but not act; only admins edit handlers", async () => {
      await say("u-lan", dmThread, "báo lỗi: camera cổng mất hình");
      await db.query("DELETE FROM job");
      const manager = await login("quanly", "Ql@12345", 2);
      const list = await call("GET", "/api/tickets?status=1", undefined, manager);
      assert.equal(list.status, 200, JSON.stringify(list.body));
      assert.equal(list.body.data.items[0].code, "T-0001");
      assert.equal(list.body.data.items[0].source_name, "Tin riêng");
      const done = await call("POST", "/api/tickets/1/actions", { action: "accept" }, manager);
      assert.equal(done.status, 200, JSON.stringify(done.body));
      assert.equal(done.body.data.status, TicketStatus.InProgress);
      assert.deepEqual(done.body.data.events.map((event: { kind: number; via: string }) => [event.kind, event.via]), [[1, "zalo"], [2, "web"]]);
      assert.match((await messages())[0].text!, /đã được quanly nhận/);
      assert.equal((await call("POST", "/api/tickets/1/actions", { action: "reopen" }, manager)).status, 409);
      assert.equal((await call("POST", "/api/tickets/1/actions", { action: "note" }, manager)).status, 422);
      assert.equal((await call("POST", "/api/ticket-handlers", { contact_id: contactIds["u-binh"] }, manager)).status, 403);

      const staff = await login("nhanvien", "Nv@12345", 3);
      assert.equal((await call("GET", "/api/tickets/1", undefined, staff)).status, 200);
      assert.equal((await call("POST", "/api/tickets/1/actions", { action: "done" }, staff)).status, 403);

      const admin = await login("admin", "Ad@12345");
      assert.equal((await call("POST", "/api/ticket-handlers", { contact_id: contactIds["u-binh"] }, admin)).status, 200);
      assert.equal((await call("GET", "/api/ticket-handlers", undefined, admin)).body.data.length, 3);
      assert.equal((await call("DELETE", `/api/ticket-handlers/${contactIds["u-binh"]}`, undefined, admin)).status, 200);
    });
  });
});
