// Phase 8 — họ `tickets` qua MCP trong tiến trình. MySQL thật. TEST VÀNG: lệnh ticket gõ (đường cũ `runTicketCommandLegacy` so với đường MCP:
// công cụ mặt `assistant_command` + câu dựng từ kết quả có cấu trúc) cho CÙNG câu trả lời từng ký tự và CÙNG trạng thái DB (ticket, sự kiện, hàng đợi báo Zalo)
// trên ma trận người hỏi × quan hệ × nhóm nguồn × cuộc đang hỏi × trạng thái ticket × lệnh. Cộng: công cụ mô hình giữ tên + khai báo, ghi do mô hình
// khởi xướng vẫn GHI NGAY (BC1 bỏ), mô hình không có đường tới công cụ lệnh, cổng /mcp ngoài không thấy công cụ ticket.
//
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_p8 npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { AssistantService, type AssistantRequest } from "../src/assistant/assistant-service.js";
import type { GeminiContent, ModelClient } from "../src/assistant/gemini-client.js";
import { resolveAskerAccess, type AskerAccess } from "../src/assistant/infra/asker-access.js";
import type { AssistantMcpBridge } from "../src/assistant/mcp-bridge/assistant-mcp-bridge-config.js";
import { parseMcpFamilies } from "../src/assistant/mcp-bridge/assistant-mcp-families.js";
import { openMcpTurn } from "../src/assistant/mcp-bridge/open-mcp-turn.js";
import { AttachmentStatus, ContactRole, TicketStatus, UserRole } from "../src/constants.js";
import { ALL_TOOLS, toolsFor } from "../src/data-access/read-tool-catalog.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { ConcurrencyGate } from "../src/mcp/mcp-concurrency-gate.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import { buildTicketContext, runTicketCommand, type TicketCommand } from "../src/tickets/ticket-commands.js";
import { runTicketCommandLegacy } from "../src/tickets/ticket-commands-legacy.js";
import { TICKET_TOOL_NAMES } from "../src/tickets/ticket-tools.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-20T05:00:00Z");
const TABLES = ["mcp_call_log", "mcp_write_draft", "assistant_turn", "ticket_event", "ticket_attachment", "ticket_handler", "ticket", "job", "attachment", "message",
  "group_member", "bot_group", "zalo_group", "contact_tag", "contact", "company", "session_event", "bot_account", "user_group_scope", "app_user", "recipient_group", "recipient"];

class CountingGate extends ConcurrencyGate {
  acquires = 0;
  override acquire(): ReturnType<ConcurrencyGate["acquire"]> {
    this.acquires += 1;
    return super.acquire();
  }
}

type Parts = GeminiContent["parts"];
class ScriptedModel implements ModelClient {
  readonly requests: { contents: GeminiContent[]; tools: { name: string }[] }[] = [];
  constructor(private readonly turns: Parts[]) {}
  async generate(request: { contents: GeminiContent[]; tools: { name: string }[] }) {
    this.requests.push({ contents: structuredClone(request.contents), tools: structuredClone(request.tools) });
    const turn = this.turns.shift();
    if (!turn) throw new Error("hết kịch bản");
    return { content: { role: "model" as const, parts: turn }, inputTokens: 10, outputTokens: 5 };
  }
}

interface Persona { uid: string; contactId: number; role: number }
type Location = "dm" | "groupA" | "groupB";

describe("họ tickets qua MCP (phase 8)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let dmThread = 0;
  let groupA = 0;
  let groupB = 0;
  let secretGroup = 0;
  let personas: Record<string, Persona> = {};
  const bridgeGate = new CountingGate(5, 20_000);
  const bridge: AssistantMcpBridge = { families: () => parseMcpFamilies("tickets"), gate: bridgeGate };

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });

  const insertId = async (sql: string, params: unknown[] = []): Promise<number> => ((await db.query<any>(sql, params))[0] as any).insertId as number;
  const rows = async (sql: string, params: unknown[] = []) => (await db.query<RowDataPacket[]>(sql, params))[0];

  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    await insertId("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    const group = (zaloId: string, name: string, type: number, secret = 0) =>
      insertId("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages, is_confidential) VALUES (?, ?, ?, 1, ?)", [type, zaloId, name, secret]);
    dmThread = await group("u-req", "Tin riêng", 2);
    groupA = await group("g-a", "Kho Cần Thơ", 1);
    groupB = await group("g-b", "Kế toán", 1);
    secretGroup = await group("g-s", "Ban giám đốc", 1, 1);
    const contact = async (uid: string, name: string, role: number) => ({ uid, role, contactId: await insertId("INSERT INTO contact (zalo_uid, display_name, role, kind) VALUES (?, ?, ?, 2)", [uid, name, role]) });
    personas = {
      requester: await contact("u-req", "Lan", ContactRole.None), handler: await contact("u-hdl", "Hùng IT", ContactRole.None),
      manager: await contact("u-mgr", "Quản Lý Bình", ContactRole.Manager), stranger: await contact("u-str", "Khách lạ", ContactRole.None),
      disabled: await contact("u-dis", "Đã tắt", ContactRole.Manager), web: await contact("u-web", "Web Minh", ContactRole.DepartmentHead),
    };
    await db.query("INSERT INTO ticket_handler (contact_id) VALUES (?)", [personas.handler.contactId]);
    const account = (name: string, contactId: number, active: number) => db.query(
      "INSERT INTO app_user (email, username, full_name, role, contact_id, all_groups, can_view_confidential, is_active) VALUES (?, ?, ?, ?, ?, 1, 0, ?)", [`${name}@x.vn`, name, name, UserRole.Manager, contactId, active]);
    await account("dis", personas.disabled.contactId, 0);
    await account("web", personas.web.contactId, 1);
    bridgeGate.acquires = 0;
  });

  async function accessFor(persona: Persona, location: Location): Promise<AskerAccess> {
    const contact = (await findContactByUid(db, persona.uid))!;
    const groupScopeId = location === "dm" ? undefined : location === "groupA" ? groupA : groupB;
    return resolveAskerAccess(db, contact, { groupScopeId, maskPersonal: false, now: NOW, turn: { threadId: groupScopeId ?? dmThread, messageId: null, botAccountId: 1 } });
  }

  /** Chạy cùng một lệnh ở hai đường; trả câu trả lời + số lần lấy chỗ cổng MCP của lần chạy MCP. */
  async function runBoth(persona: Persona, location: Location, command: TicketCommand, reset: () => Promise<void>) {
    const access = await accessFor(persona, location);
    const scopeGroupId = location === "dm" ? undefined : location === "groupA" ? groupA : groupB;
    const name = (await findContactByUid(db, persona.uid))!.display_name || persona.uid;
    const base = { contact: { id: persona.contactId, uid: persona.uid, name, role: persona.role }, threadId: scopeGroupId ?? dmThread, messageId: null, botAccountId: 1, scopeGroupId, access: async () => access };
    const oldDownloads: number[] = [];
    const newDownloads: number[] = [];
    const old = await runTicketCommandLegacy(buildTicketContext({ db, requestDownload: (ids) => { oldDownloads.push(...ids); } }, base), command, NOW);
    const oldState = await snapshot();
    await reset();
    let turn: ReturnType<typeof openMcpTurn>;
    const before = bridgeGate.acquires;
    const ctx = buildTicketContext({ db, requestDownload: (ids) => { newDownloads.push(...ids); } }, base);
    ctx.mcp = async () => (turn ??= openMcpTurn(access, bridge, { groupScopeId: scopeGroupId }));
    let next: string;
    try {
      next = await runTicketCommand(ctx, command, NOW);
    } finally {
      await turn?.close();
    }
    return { old, next, oldState, newState: await snapshot(), calls: bridgeGate.acquires - before, oldDownloads, newDownloads };
  }

  /** Trạng thái đáng so: mọi ticket (bỏ mã ngẫu nhiên / giờ DB), sự kiện, hàng đợi báo Zalo (nội dung — dedupe key có giờ nên bỏ). */
  async function snapshot() {
    const tickets = await rows("SELECT id, status, title, body, requester_uid, requester_name, source_thread_id, source_message_id, bot_account_id, handler_contact_id, handler_name, COALESCE(resolution, '') AS resolution, closed_at IS NULL AS still_open FROM ticket ORDER BY id");
    const events = await rows("SELECT ticket_id, kind, actor_name, via, COALESCE(note, '') AS note FROM ticket_event ORDER BY id");
    const attachments = await rows("SELECT ta.ticket_id, ta.attachment_id, a.status FROM ticket_attachment ta JOIN attachment a ON a.id = ta.attachment_id ORDER BY ta.attachment_id");
    const jobs = (await rows("SELECT payload FROM job ORDER BY id")).map((row) => JSON.stringify(row.payload));
    return { tickets, events, attachments, jobs };
  }

  async function reseed(ticketId: number, initial: RowDataPacket): Promise<void> {
    await db.query("DELETE FROM ticket_event WHERE ticket_id = ?", [ticketId]);
    await db.query("DELETE FROM ticket_attachment");
    await db.query("DELETE FROM job");
    await db.query("UPDATE ticket SET status = ?, handler_contact_id = ?, handler_name = ?, resolution = ?, closed_at = ?, accepted_at = ? WHERE id = ?",
      [initial.status, initial.handler_contact_id, initial.handler_name, initial.resolution, initial.closed_at, initial.accepted_at, ticketId]);
  }

  const COMMANDS: Record<string, (id: number) => TicketCommand> = {
    status: (ticketId) => ({ kind: "ticket_status", ticketId }), accept: (ticketId) => ({ kind: "ticket_accept", ticketId }),
    done: (ticketId) => ({ kind: "ticket_done", ticketId, note: "đã thay mực" }), done_bare: (ticketId) => ({ kind: "ticket_done", ticketId, note: "" }),
    cancel: (ticketId) => ({ kind: "ticket_cancel", ticketId, note: "nhầm" }), note: (ticketId) => ({ kind: "ticket_note", ticketId, note: "bổ sung: máy vẫn kẹt" }),
  };

  test("VÀNG: ma trận người hỏi × quan hệ × nhóm nguồn × cuộc × trạng thái × lệnh — câu trả lời + DB cũ == MCP, mỗi lệnh đúng MỘT lời gọi công cụ", async () => {
    let compared = 0;
    for (const persona of Object.values(personas)) {
      for (const relation of ["owner", "other"] as const) {
        for (const source of [dmThread, groupA, secretGroup]) {
          for (const status of [TicketStatus.New, TicketStatus.Done]) {
            const ticketId = await insertId(
              "INSERT INTO ticket (code, status, title, body, requester_uid, requester_name, source_thread_id, bot_account_id, resolution, closed_at) VALUES (?, ?, 'máy in kẹt giấy', 'nội dung', ?, 'Người báo', ?, 1, ?, ?)",
              [`~g${compared}-${ticketId0()}`, status, relation === "owner" ? persona.uid : "u-other", source, status === TicketStatus.Done ? "xong từ trước" : null, status === TicketStatus.Done ? NOW : null]);
            const initial = (await rows("SELECT * FROM ticket WHERE id = ?", [ticketId]))[0];
            for (const location of ["dm", "groupA", "groupB"] as Location[]) {
              for (const [name, make] of Object.entries(COMMANDS)) {
                const result = await runBoth(persona, location, make(ticketId), () => reseed(ticketId, initial));
                const where = `${name} ${Object.keys(personas).find((key) => personas[key] === persona)} ${relation} nguồn=${source} ${status === TicketStatus.New ? "mới" : "xong"} cuộc=${location}`;
                assert.equal(result.next, result.old, where);
                assert.deepEqual(result.newState, result.oldState, where);
                assert.equal(result.calls, 1, `${where}: phải có đúng 1 tools/call`);
                await reseed(ticketId, initial);
                compared += 1;
              }
            }
          }
        }
      }
    }
    assert.equal(compared, 6 * 2 * 3 * 2 * 3 * 6);
  });

  let uniq = 0;
  const ticketId0 = () => (uniq += 1);

  test("VÀNG danh sách: sếp thấy ticket đang mở (theo nhóm / Mật), người khác thấy ticket mình báo — mọi người hỏi × cuộc", async () => {
    const seed = [[personas.requester.uid, dmThread, TicketStatus.New], [personas.requester.uid, groupA, TicketStatus.InProgress], ["u-other", groupA, TicketStatus.New],
      ["u-other", groupB, TicketStatus.New], ["u-other", secretGroup, TicketStatus.New], [personas.manager.uid, dmThread, TicketStatus.Done], ["u-other", dmThread, TicketStatus.InProgress]] as const;
    for (const [uid, thread, status] of seed) {
      await insertId("INSERT INTO ticket (code, status, title, body, requester_uid, requester_name, source_thread_id, bot_account_id, handler_name) VALUES (?, ?, ?, 'x', ?, 'Người báo', ?, 1, 'Hùng IT')",
        [`~l${ticketId0()}`, status, `sự cố ${uid}/${thread}`, uid, thread]);
    }
    let nonEmpty = 0;
    for (const persona of Object.values(personas)) {
      for (const location of ["dm", "groupA", "groupB"] as Location[]) {
        const result = await runBoth(persona, location, { kind: "ticket_list" }, async () => undefined);
        assert.equal(result.next, result.old, `${persona.uid} ${location}`);
        assert.equal(result.calls, 1);
        if (/^TICKET/.test(result.old)) nonEmpty += 1;
      }
    }
    assert.ok(nonEmpty >= 8, `quá ít danh sách có dòng (${nonEmpty})`);
  });

  test("VÀNG báo mới: người hỏi × cuộc — câu, ticket mới (nguồn, bot, người báo), báo người xử lý, ảnh vừa gửi gắn đúng", async () => {
    const attachmentFor = async (sender: Persona) => {
      const messageId = await insertId("INSERT INTO message (group_id, zalo_msg_id, kind, sender_uid, sender_name, sent_at, text) VALUES (?, ?, 2, ?, ?, ?, NULL)",
        [dmThread, `m-${ticketId0()}`, sender.uid, sender.uid, new Date(NOW.getTime() - 60_000)]);
      // «Bỏ qua» (nhóm chưa bật lấy tệp): ticket đưa lại hàng tải → bộ tải phải nhận đúng id ở cả hai đường
      await insertId("INSERT INTO attachment (message_id, group_id, file_name, file_ext, source_url, status) VALUES (?, ?, '', 'jpg', 'https://p', ?)", [messageId, dmThread, AttachmentStatus.Skipped]);
    };
    for (const persona of Object.values(personas)) {
      for (const location of ["dm", "groupA"] as Location[]) {
        await attachmentFor(persona);
        const nextId = ((await rows("SELECT COALESCE(MAX(id), 0) + 1 AS next FROM ticket"))[0].next as number);
        const reset = async () => {
          await db.query("DELETE FROM ticket_event"); await db.query("DELETE FROM ticket_attachment"); await db.query("DELETE FROM job"); await db.query("DELETE FROM ticket");
          await db.query("UPDATE attachment SET status = ?, attempts = 0", [AttachmentStatus.Skipped]);
          await db.query(`ALTER TABLE ticket AUTO_INCREMENT = ${nextId}`);
        };
        const result = await runBoth(persona, location, { kind: "ticket_create", text: "máy in hỏng\nkhông ra giấy" }, reset);
        assert.equal(result.next, result.old, `${persona.uid} ${location}`);
        assert.deepEqual(result.newState, result.oldState, `${persona.uid} ${location}`);
        assert.equal(result.newState.tickets.length, 1);
        assert.equal(result.newState.attachments.length, location === "dm" ? 1 : 0, "ảnh vừa gửi ở tin riêng gắn vào ticket báo ở tin riêng");
        assert.deepEqual(result.newDownloads, result.oldDownloads, `${persona.uid} ${location}: id tải`);
        assert.equal(result.newDownloads.length, location === "dm" ? 1 : 0);
        assert.equal(result.calls, 1);
        await reset();
        await db.query("DELETE FROM attachment"); await db.query("DELETE FROM message");
      }
    }
  });

  test("ticket gõ số 0 («T-0») cho cùng câu «không thấy» như đường cũ, không gọi công cụ", async () => {
    const result = await runBoth(personas.manager, "dm", { kind: "ticket_status", ticketId: 0 }, async () => undefined);
    assert.equal(result.next, result.old);
    assert.equal(result.calls, 0);
  });

  // ------------------------------------------------------------------ Mô hình
  /** Lưu tin hỏi của `persona` (một dòng cho mỗi cặp người + câu — chạy lại không đổi id tin, nên `source_message_id` của ticket mới giống nhau giữa hai chế độ). */
  async function storeQuestion(persona: Persona, question: string): Promise<number> {
    const key = `q-${persona.uid}-${question}`.slice(0, 40);
    await db.query("INSERT IGNORE INTO message (group_id, zalo_msg_id, kind, sender_uid, sender_name, sent_at, text) VALUES (?, ?, 0, ?, ?, ?, ?)", [dmThread, key, persona.uid, persona.uid, NOW, question]);
    return Number((await rows("SELECT id FROM message WHERE group_id = ? AND zalo_msg_id = ?", [dmThread, key]))[0].id);
  }
  async function modelRun(families: string, script: Parts[], persona: Persona = personas.handler) {
    const model = new ScriptedModel(script);
    const service = new AssistantService(db, model, "gia-lap", { maxPerHour: 100, dailyTokenCap: 10_000_000 }, () => NOW,
      { tickets: { db, wakeJobs: () => undefined }, mcpBridge: { families: () => parseMcpFamilies(families), gate: bridgeGate } });
    const contact = (await findContactByUid(db, persona.uid))!;
    // D-A (20/10/2026): hủy / ghi chú ticket do mô hình khởi xướng chỉ ghi NGAY khi mã ticket nằm trong tin của chính người hỏi — lưu tin hỏi như thật
    const question = "đóng ticket T-1 giúp anh";
    const questionMessageId = await storeQuestion(persona, question);
    const request: AssistantRequest = { botAccountId: 1, contact, threadId: dmThread, questionMessageId, question };
    const reply = await service.answer(request);
    const responses = model.requests.at(-1)!.contents.flatMap((content) => content.parts).flatMap((part) => (part.functionResponse ? [part.functionResponse.response] : []));
    return { reply, responses, model };
  }
  const call = (name: string, args: Record<string, unknown>) => ({ functionCall: { name, args } });

  async function seedOneTicket(requesterUid = personas.requester.uid) {
    await db.query("DELETE FROM ticket");
    await db.query("ALTER TABLE ticket AUTO_INCREMENT = 1");
    await insertId("INSERT INTO ticket (code, status, title, body, requester_uid, requester_name, source_thread_id, bot_account_id) VALUES ('T-0001', ?, 'máy in kẹt giấy', 'nội dung', ?, 'Lan', ?, 1)", [TicketStatus.New, requesterUid, dmThread]);
  }

  test("công cụ mô hình: tên + khai báo GIỮ NGUYÊN; ghi do mô hình khởi xướng vẫn GHI NGAY (BC1 bỏ) và cùng kết quả hai chế độ", async () => {
    const scripts: [string, Parts][] = [
      ["ticket_action done", [call("ticket_action", { ticket_id: 1, action: "done", note: "đã thay mực" })]],
      ["ticket_action accept", [call("ticket_action", { ticket_id: 1, action: "accept" })]],
      ["ticket_action status", [call("ticket_action", { ticket_id: 1, action: "status" })]],
      ["ticket_action note rỗng", [call("ticket_action", { ticket_id: 1, action: "note" })]],
      ["ticket_action id sai", [call("ticket_action", { ticket_id: 0, action: "done" })]],
      ["ticket_action ticket lạ", [call("ticket_action", { ticket_id: 99, action: "done" })]],
      ["list_tickets", [call("list_tickets", {})]],
      ["create_ticket", [call("create_ticket", { text: "máy chiếu không lên hình" })]],
      ["create_ticket ngắn", [call("create_ticket", { text: "  " })]],
    ];
    let declarationsChecked = false;
    for (const [label, script] of scripts) {
      const outcomes: unknown[] = [];
      for (const families of ["", "tickets"]) {
        await seedOneTicket();
        await db.query("DELETE FROM ticket_event"); await db.query("DELETE FROM job");
        const run = await modelRun(families, [script, [{ text: "xong" }]]);
        outcomes.push({ responses: run.responses, state: await snapshot(), text: run.reply.text });
        const declared = run.model.requests[0].tools.filter((tool) => TICKET_TOOL_NAMES.has(tool.name));
        assert.deepEqual(declared.map((tool) => tool.name), ["list_tickets", "ticket_action", "create_ticket"], `${label} (${families || "cũ"}): khai báo thiếu / sai thứ tự`);
        outcomes.push(declared);
      }
      assert.deepEqual(outcomes[2], outcomes[0], `${label}: kết quả công cụ + DB khác giữa hai chế độ`);
      assert.deepEqual(outcomes[3], outcomes[1], `${label}: khai báo công cụ khác giữa hai chế độ`);
      declarationsChecked = true;
    }
    assert.ok(declarationsChecked);
    // Ghi NGAY: ticket đóng khi mô hình gọi done, không chờ «đồng ý»
    await seedOneTicket();
    await db.query("DELETE FROM job");
    const acquiredBefore = bridgeGate.acquires;
    await modelRun("tickets", [[call("ticket_action", { ticket_id: 1, action: "done", note: "ok" })], [{ text: "đã đóng" }]]);
    assert.equal((await rows("SELECT status FROM ticket WHERE id = 1"))[0].status, TicketStatus.Done);
    assert.equal((await rows("SELECT COUNT(*) AS n FROM mcp_write_draft"))[0].n, 0, "ghi ngay thì không để lại nháp");
    assert.ok(bridgeGate.acquires > acquiredBefore, "ghi do mô hình phải đi qua tools/call thật");
  });

  test("mô hình KHÔNG có đường tới công cụ lệnh; nhật ký gọi: mô hình = nguồn 2, lệnh gõ = nguồn 3, cả hai có contact_id; cổng /mcp ngoài không thấy công cụ ticket", async () => {
    await seedOneTicket(personas.handler.uid);
    const access = await accessFor(personas.handler, "dm");
    const turn = openMcpTurn(access, bridge, { wakeJobs: () => undefined })!;
    try {
      const model = (await turn.model())!;
      const command = (await turn.command())!;
      for (const name of ["ticket_list_for_actor", "ticket_get", "ticket_create", "ticket_act"]) {
        assert.ok(!model.toolNames.has(name), `mô hình thấy ${name}`);
        assert.ok(command.toolNames.has(name), `lệnh thiếu ${name}`);
      }
      for (const name of ["ticket_action", "create_ticket"]) assert.ok(model.toolNames.has(name) && !command.toolNames.has(name));
      await assert.rejects(turn.callTool("assistant_model", "ticket_act", { ticket_id: 1, action: "done" }));
      await turn.callTool("assistant_model", "ticket_action", { ticket_id: 1, action: "status" });
      await turn.callTool("assistant_command", "ticket_list_for_actor", {});
      assert.ok(model.instructions.includes("TICKET:"));
    } finally {
      await turn.close();
    }
    // Wrapper đợi ghi nhật ký xong trước khi trả lời ⇒ đọc thẳng, thứ tự theo lời gọi (không đợi / không chạy đua)
    const logs = await rows("SELECT tool, source, contact_id, key_id FROM mcp_call_log WHERE tool IN ('ticket_action', 'ticket_list_for_actor', 'ticket_act') ORDER BY id");
    assert.deepEqual(logs.map((row) => [row.tool, row.source]), [["ticket_action", 2], ["ticket_list_for_actor", 3]]);
    assert.ok(logs.every((row) => row.contact_id === personas.handler.contactId && row.key_id === null));
    const external = new Set(toolsFor({ ...access, contactActor: undefined }, "mcp_http", ALL_TOOLS).map((tool) => tool.name));
    for (const name of [...TICKET_TOOL_NAMES, "ticket_list_for_actor", "ticket_get", "ticket_create", "ticket_act"]) assert.ok(!external.has(name), `cổng ngoài lộ ${name}`);
  });

  // ------------------------------------------------------------------ Tích hợp sau đợt 1 (assistant-service)
  async function serviceTurn(families: string, persona: Persona, question: string, script: Parts[], downloads: number[] = []) {
    const model = new ScriptedModel(script);
    const service = new AssistantService(db, model, "gia-lap", { maxPerHour: 100, dailyTokenCap: 10_000_000 }, () => NOW,
      { tickets: { db, wakeJobs: () => undefined, requestDownload: (ids) => { downloads.push(...ids); } }, mcpBridge: { families: () => parseMcpFamilies(families), gate: bridgeGate } });
    const contact = (await findContactByUid(db, persona.uid))!;
    // D-A: tin hỏi được lưu để chốt chặn đọc mã ticket do chính người hỏi nêu
    const reply = await service.answer({ botAccountId: 1, contact, threadId: dmThread, questionMessageId: await storeQuestion(persona, question), question });
    return { reply, model };
  }
  const waitForLogs = async (sql: string, min: number) => {
    let logs = await rows(sql);
    for (let attempt = 0; attempt < 40 && logs.length < min; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      logs = await rows(sql);
    }
    return logs;
  };

  test("lệnh gõ «ticket» qua AssistantService thật: họ tickets bật ⇒ mcp_call_log nguồn 3 (ticket_list_for_actor); họ tắt ⇒ không dòng nào, cùng câu trả lời", async () => {
    await seedOneTicket();
    const replies: (string | null)[] = [];
    for (const families of ["", "tickets"]) {
      await db.query("DELETE FROM mcp_call_log");
      const { reply, model } = await serviceTurn(families, personas.requester, "ticket", []);
      assert.equal(model.requests.length, 0, "lệnh gõ không qua mô hình");
      replies.push(reply.text);
      const logs = await waitForLogs("SELECT tool, source, contact_id FROM mcp_call_log", families ? 1 : 0);
      if (families) assert.deepEqual(logs.map((row) => [row.tool, row.source, row.contact_id]), [["ticket_list_for_actor", 3, personas.requester.contactId]]);
      else assert.equal(logs.length, 0);
    }
    assert.match(String(replies[1]), /T-0001/);
    assert.equal(replies[1], replies[0]);
  });

  test("create_ticket do MÔ HÌNH khởi xướng: ảnh «Bỏ qua» vừa gửi được đưa về hàng tải qua ctx.requestDownload (như đường cũ); ticket_action note cũng vậy", async () => {
    for (const families of ["", "tickets"]) {
      await seedOneTicket(personas.requester.uid);
      await db.query("DELETE FROM attachment"); await db.query("DELETE FROM message"); await db.query("DELETE FROM ticket_attachment");
      const messageId = await insertId("INSERT INTO message (group_id, zalo_msg_id, kind, sender_uid, sender_name, sent_at, text) VALUES (?, ?, 2, ?, 'Lan', ?, NULL)",
        [dmThread, `m-${families || "old"}`, personas.requester.uid, new Date(NOW.getTime() - 60_000)]);
      const attachmentId = await insertId("INSERT INTO attachment (message_id, group_id, file_name, file_ext, source_url, status) VALUES (?, ?, '', 'jpg', 'https://p', ?)", [messageId, dmThread, AttachmentStatus.Skipped]);
      const downloads: number[] = [];
      await serviceTurn(families, personas.requester, "báo giúp máy in hỏng", [[{ functionCall: { name: "create_ticket", args: { text: "máy in hỏng ở kho" } } }], [{ text: "xong" }]], downloads);
      assert.deepEqual(downloads, [attachmentId], `${families || "cũ"}: create_ticket phải đưa ảnh về hàng tải`);
      assert.equal((await rows("SELECT status FROM attachment WHERE id = ?", [attachmentId]))[0].status, AttachmentStatus.Pending);

      // Bổ sung ghi chú vào ticket cũ + ảnh mới
      await db.query("DELETE FROM ticket_attachment");
      await db.query("UPDATE attachment SET status = ?", [AttachmentStatus.Skipped]);
      downloads.length = 0;
      await serviceTurn(families, personas.requester, "bổ sung T-1", [[{ functionCall: { name: "ticket_action", args: { ticket_id: 1, action: "note", note: "kèm ảnh" } } }], [{ text: "xong" }]], downloads);
      assert.deepEqual(downloads, [attachmentId], `${families || "cũ"}: ticket_action note phải đưa ảnh về hàng tải`);
    }
  });

  test("che dữ liệu cá nhân: mặt lệnh gõ (trả thẳng người dùng) KHÔNG che như đường cũ, mặt mô hình vẫn che", async () => {
    await seedOneTicket(personas.handler.uid);
    await db.query("UPDATE ticket SET title = 'gọi khách 0912345678 gấp'");
    const contact = (await findContactByUid(db, personas.handler.uid))!;
    const access = await resolveAskerAccess(db, contact, { maskPersonal: true, now: NOW, turn: { threadId: dmThread, messageId: null, botAccountId: 1 } });
    assert.equal(access.maskPersonal, true);
    const turn = openMcpTurn(access, bridge, { wakeJobs: () => undefined })!;
    try {
      const forUser = await turn.callTool("assistant_command", "ticket_get", { ticket_id: 1 });
      assert.match(JSON.stringify(forUser.structuredContent), /0912345678/, "lệnh gõ không được che");
      const forModel = await turn.callTool("assistant_model", "ticket_action", { ticket_id: 1, action: "status" });
      assert.doesNotMatch(JSON.stringify(forModel.structuredContent), /0912345678/, "mô hình phải thấy bản đã che");
    } finally {
      await turn.close();
    }
  });

  test("list_tickets (không tham số) đi qua MCP ở mặt mô hình, kết quả bằng đường cũ", async () => {
    await seedOneTicket(personas.requester.uid);
    const results: unknown[] = [];
    for (const families of ["", "tickets"]) {
      const before = bridgeGate.acquires;
      const { reply, model } = await serviceTurn(families, personas.requester, "tôi có ticket nào?", [[{ functionCall: { name: "list_tickets", args: {} } }], [{ text: "ok" }]]);
      const response = model.requests.at(-1)!.contents.flatMap((content) => content.parts).flatMap((part) => (part.functionResponse ? [part.functionResponse.response] : []));
      results.push(response);
      assert.equal(reply.text, "ok");
      if (families) assert.ok(bridgeGate.acquires > before, "list_tickets phải là tools/call thật");
    }
    assert.deepEqual(results[1], results[0]);
    assert.match(JSON.stringify(results[1]), /T-0001/);
  });

  test("bot không cấu hình ticket (ngữ cảnh không có wakeJobs): mô hình không thấy công cụ ticket, như đường cũ", async () => {
    const turn = openMcpTurn(await accessFor(personas.handler, "dm"), bridge, {})!;
    try {
      const model = (await turn.model())!;
      for (const name of TICKET_TOOL_NAMES) assert.ok(!model.toolNames.has(name), `mô hình thấy ${name}`);
      assert.ok((await turn.command())!.toolNames.has("ticket_act"), "lệnh gõ vẫn dùng được (nơi gọi đã có ngữ cảnh ticket)");
    } finally {
      await turn.close();
    }
  });

  test("họ tắt: không phiên MCP nào được mở cho lệnh ticket (đường cũ nguyên vẹn)", async () => {
    await seedOneTicket();
    const access = await accessFor(personas.requester, "dm");
    const before = bridgeGate.acquires;
    const ctx = buildTicketContext({ db }, { contact: { id: personas.requester.contactId, uid: personas.requester.uid, name: "Lan", role: 0 }, threadId: dmThread, messageId: null, botAccountId: 1, access: async () => access });
    let opened = 0;
    ctx.mcp = async () => { opened += 1; return openMcpTurn(access, { families: () => parseMcpFamilies("core"), gate: bridgeGate }, {}); };
    assert.match(await runTicketCommand(ctx, { kind: "ticket_status", ticketId: 1 }, NOW), /^T-0001: máy in kẹt giấy/);
    assert.equal(opened, 1);
    assert.equal(bridgeGate.acquires, before, "họ tickets tắt thì không tools/call");
  });
});
