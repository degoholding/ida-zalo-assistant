// Phase 5 — chủ thể «liên hệ Zalo»: migration 042–044, nháp gắn theo liên hệ (người KHÔNG có tài khoản web), nhật ký gọi có contact_id, bộ phân giải
// tên người / nhóm so với `resolveAssignee`, và TEST VÀNG: luật quan hệ việc / ticket mới (data-access/actors) cho CÙNG quyết định với luật cũ
// (task-permissions.ts + buildTaskContext, runTicketCommand) trên ma trận vai × người nhận × nguồn danh tính × quan hệ × cuộc. MySQL thật.
//
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_am5 npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { AssistantService, type AssistantRequest } from "../src/assistant/assistant-service.js";
import type { GeminiContent, ModelClient } from "../src/assistant/gemini-client.js";
import type { AskerAccess } from "../src/assistant/infra/asker-access.js";
import { parseMcpFamilies } from "../src/assistant/mcp-bridge/assistant-mcp-families.js";
import { ContactRole, McpAccessLevel, McpCallSource, TicketStatus, UserRole } from "../src/constants.js";
import { buildContactActor, type AskerOrigin } from "../src/data-access/actors/contact-actor.js";
import { decideTaskRelationship, decideTicketRelationship, type TicketAction } from "../src/data-access/actors/contact-relationship-rules.js";
import { buildDataAccessContext, type DataAccessContext } from "../src/data-access/data-access-context.js";
import { findTool } from "../src/data-access/read-tool-catalog.js";
import { requireOneGroup, resolveGroupName } from "../src/data-access/resolvers/group-name-resolver.js";
import { resolvePersonName } from "../src/data-access/resolvers/person-name-resolver.js";
import { runTool } from "../src/data-access/tool-runner.js";
import { executeOpenDraft } from "../src/data-access/write/confirm-write-tool.js";
import { proposeTool } from "../src/data-access/write/propose-tool-factory.js";
import { findOpenDraft, draftBindingOf } from "../src/data-access/write/write-draft-store.js";
import { eraseAction, type AnyWriteAction, type WriteAction } from "../src/data-access/write/write-action.js";
import { WRITE_ACTIONS } from "../src/data-access/write/write-tool-catalog.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { ConcurrencyGate } from "../src/mcp/mcp-concurrency-gate.js";
import { connectTestClient } from "../src/mcp/mcp-test-support.js";
import { describeContactChoices } from "../src/sync/contact-search.js";
import { findContactByUid } from "../src/sync/contact-repository.js";
import { buildTaskContext, resolveAssignee } from "../src/tasks/task-commands.js";
import { canManageTask, canViewTask, canWorkOnTask, isTaskAssignee, isTaskAssigner, type TaskViewer } from "../src/tasks/task-permissions.js";
import type { TaskRow } from "../src/tasks/task-repository.js";
import { buildTicketContext, runTicketCommand, type TicketCommand } from "../src/tickets/ticket-commands.js";
import { isTicketVisible, overseerPart } from "../src/tickets/ticket-visibility.js";
import { contactScopeSql } from "../src/web/api/scope.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
// Giờ thật (tròn phút): nháp hết hạn theo đồng hồ thật ở vài nhánh — giờ cứng sẽ thành «bom hẹn giờ» sau 10–15 phút
const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000);
const TABLES = ["mcp_call_log", "mcp_write_draft", "assistant_turn", "ticket_event", "ticket_attachment", "ticket_handler", "ticket", "job", "message",
  "group_member", "bot_group", "zalo_group", "contact_tag", "contact", "company", "session_event", "bot_account", "user_group_scope", "app_user", "recipient_group",
  "recipient"];

type Parts = GeminiContent["parts"];
class ScriptedModel implements ModelClient {
  constructor(private readonly turns: Parts[]) {}
  async generate() {
    const turn = this.turns.shift();
    if (!turn) throw new Error("hết kịch bản");
    return { content: { role: "model" as const, parts: turn }, inputTokens: 10, outputTokens: 5 };
  }
}

const ROLES = [ContactRole.None, ContactRole.DepartmentHead, ContactRole.Manager];
const ORIGINS: AskerOrigin[] = ["web_user", "derived_role", "derived_recipient", "disabled_account"];

describe("chủ thể liên hệ Zalo (phase 5)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let groupA = 0;
  let groupB = 0;
  let secretGroup = 0;
  let seq = 0;

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    await db.query("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    const insertGroup = async (zaloId: string, name: string, label: string, secret: number) =>
      ((await db.query<any>("INSERT INTO zalo_group (thread_type, zalo_group_id, name, label, read_messages, is_confidential) VALUES (1, ?, ?, ?, 1, ?)", [zaloId, name, label, secret]))[0] as any).insertId as number;
    groupA = await insertGroup("g-a", "Kho Cần Thơ", "K52", 0);
    groupB = await insertGroup("g-b", "Kế toán", "", 0);
    secretGroup = await insertGroup("g-s", "Ban giám đốc", "", 1);
  });

  async function insertContact(uid: string, name: string, role = ContactRole.None, kind = 2): Promise<number> {
    const [result] = await db.query<any>("INSERT INTO contact (zalo_uid, display_name, role, kind) VALUES (?, ?, ?, ?)", [uid, name, role, kind]);
    return result.insertId;
  }
  const one = async (sql: string, params: unknown[] = []): Promise<RowDataPacket> => (await db.query<RowDataPacket[]>(sql, params))[0][0];

  // ------------------------------------------------------------------ Migration
  test("migration 042–044: chạy lại KHÔNG lỗi (có kiểm information_schema), cột + chỉ mục đúng", async () => {
    await db.query("DELETE FROM schema_migration WHERE name IN ('042_mcp_call_log_contact_id.sql', '043_mcp_write_draft_user_nullable.sql', '044_mcp_write_draft_contact_id.sql')");
    const reran = await runMigrations(databaseUrl!);
    assert.deepEqual(reran, ["042_mcp_call_log_contact_id.sql", "043_mcp_write_draft_user_nullable.sql", "044_mcp_write_draft_contact_id.sql"]);
    const column = async (table: string, name: string) => one("SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?", [table, name]);
    assert.equal((await column("mcp_call_log", "contact_id")).IS_NULLABLE, "YES");
    assert.equal((await column("mcp_write_draft", "contact_id")).IS_NULLABLE, "YES");
    assert.equal((await column("mcp_write_draft", "user_id")).IS_NULLABLE, "YES");
    const indexes = (await db.query<RowDataPacket[]>("SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('mcp_call_log', 'mcp_write_draft')"))[0].map((row) => row.INDEX_NAME);
    assert.ok(indexes.includes("ix_mcp_call_log_contact") && indexes.includes("ix_mcp_write_draft_contact"));
  });

  // ------------------------------------------------------------------ Nháp theo liên hệ
  const demoSchema = z.object({ title: z.string() }).strict();
  const demoAction = eraseAction({
    tool: "demo_relationship_write", title: "Demo", description: "Thao tác quan hệ giả lập", entity: "task", permission: "relationship", schema: demoSchema, ttlMs: 2 * 60_000,
    async prepare() { return { preview: "tạo việc thử", targetEntity: "task", targetId: null, stateToken: "s1" }; },
    async execute(_ctx: unknown, payload: { title: string }) { return { entity: "task", id: 77, changed: ["Tiêu đề"], message: `Đã tạo ${payload.title}` }; },
  } as unknown as WriteAction<{ title: string }>);
  const demoActions = new Map<string, AnyWriteAction>([[demoAction.tool, demoAction]]);

  function assistantCtx(contactId: number, uid: string, overrides: Partial<DataAccessContext> = {}): DataAccessContext {
    const principal = { userId: null, tenantId: 1, fullName: uid, email: "", role: UserRole.Staff, groupIds: [], canViewConfidential: false };
    const actor = buildContactActor(db, { contact: { id: contactId, uid, name: uid, role: ContactRole.None, kind: 2 }, origin: "derived_recipient" });
    return { ...buildDataAccessContext({ db, principal, allowWrite: true, maskPersonal: false, source: McpCallSource.Assistant, now: NOW, contactActor: actor }), ...overrides };
  }

  test("liên hệ KHÔNG tài khoản tạo nháp quan hệ → user_id NULL, contact_id đúng, TTL theo thao tác; liên hệ khác «đồng ý <mã>» → Mã không đúng", async () => {
    const lan = await insertContact("u-lan", "Lan");
    const binh = await insertContact("u-binh", "Bình");
    const tool = proposeTool(eraseAction({ ...demoAction, confirmMode: undefined } as unknown as WriteAction<{ title: string }>));
    const proposed = await runTool(tool, assistantCtx(lan, "u-lan"), { title: "A" });
    assert.equal(proposed.isError, false, proposed.text);
    const code = (proposed.structured as { draft: { code: string } }).draft.code;
    const row = await one("SELECT user_id, contact_id, key_id, source, TIMESTAMPDIFF(SECOND, created_at, expires_at) AS ttl FROM mcp_write_draft ORDER BY id DESC LIMIT 1");
    assert.deepEqual([row.user_id, Number(row.contact_id), row.key_id, Number(row.source)], [null, lan, null, McpCallSource.Assistant]);
    assert.equal(Number(row.ttl), 120, "hạn riêng 2 phút, không phải 10 phút");

    // Người khác (có contact_id khác) gõ đúng mã → không thấy nháp; qua công cụ lệnh «đồng ý» cũng báo mã không đúng
    const bindingOf = (id: number, uid: string) => draftBindingOf(assistantCtx(id, uid));
    assert.equal(await findOpenDraft(db, bindingOf(binh, "u-binh"), code, NOW), null);
    const other = await runTool(findTool("confirm_draft")!, { ...assistantCtx(binh, "u-binh") }, { code });
    assert.equal(other.isError && other.errorCode, "invalid_code");
    // Chủ nháp: thấy, và thực hiện được (bảng thao tác giả lập)
    const draft = await findOpenDraft(db, bindingOf(lan, "u-lan"), code, NOW);
    assert.ok(draft);
    const done = await executeOpenDraft(assistantCtx(lan, "u-lan"), demoActions, draft!);
    assert.equal(done.message, "Đã tạo A");
    assert.equal(await findOpenDraft(db, bindingOf(lan, "u-lan"), code, NOW), null, "dùng một lần");
  });

  test("trần nháp mở tính theo (liên hệ, nguồn): hai liên hệ không tài khoản không chặn nhau", async () => {
    // Nháp chèn sẵn tạo từ 5 phút trước: chỉ chiếm trần 20 nháp MỞ, không tính vào nhịp 10 đề xuất / phút
    const OLD_DRAFT_AT = new Date(NOW.getTime() - 5 * 60_000);
    const a = await insertContact("u-a", "A");
    const b = await insertContact("u-b", "B");
    const tool = proposeTool(eraseAction({ ...demoAction } as unknown as WriteAction<{ title: string }>));
    for (let i = 0; i < 10; i++) await db.query("INSERT INTO mcp_write_draft (user_id, contact_id, source, tool, target_entity, payload_json, payload_hash, code_hash, expires_at, created_at) VALUES (NULL, ?, 2, 't', 'task', '{}', ?, ?, ?, ?)",
      [a, `h${i}`, `c${i}`, new Date(NOW.getTime() + 60_000), OLD_DRAFT_AT]);
    const blocked = await runTool(tool, assistantCtx(a, "u-a"), { title: "x" });
    assert.equal(blocked.isError, false, "10 nháp mở chưa chạm trần 20");
    for (let i = 10; i < 20; i++) await db.query("INSERT INTO mcp_write_draft (user_id, contact_id, source, tool, target_entity, payload_json, payload_hash, code_hash, expires_at, created_at) VALUES (NULL, ?, 2, 't', 'task', '{}', ?, ?, ?, ?)",
      [a, `h${i}`, `c${i}`, new Date(NOW.getTime() + 60_000), OLD_DRAFT_AT]);
    assert.equal((await runTool(tool, assistantCtx(a, "u-a"), { title: "y" })).isError && "rate_limited", "rate_limited");
    assert.equal((await runTool(tool, assistantCtx(b, "u-b"), { title: "z" })).isError, false);
  });

  // ------------------------------------------------------------------ Nhật ký gọi
  test("mcp_call_log.contact_id: lượt trợ lý có liên hệ (kể cả không tài khoản, user_id NULL); cổng HTTP NULL; HTTP không có contactActor / công cụ quan hệ", async () => {
    await db.query("INSERT INTO group_member (group_id, zalo_uid) VALUES (?, 'u-asker')", [groupA]);
    const askerId = await insertContact("u-asker", "Người hỏi", ContactRole.Manager);
    const bridge = { families: () => parseMcpFamilies("core"), gate: new ConcurrencyGate(5, 1000) };
    const service = new AssistantService(db, new ScriptedModel([[{ functionCall: { name: "query_records", args: { entity: "groups", fields: ["id"] } } }], [{ text: "xong" }]]),
      "gia-lap", { maxPerHour: 100, dailyTokenCap: 10_000_000 }, () => NOW, { coreQueryTools: true, mcpBridge: bridge });
    const contact = (await findContactByUid(db, "u-asker"))!;
    const request: AssistantRequest = { botAccountId: 1, contact, threadId: 1, questionMessageId: 5, question: "liệt kê nhóm" };
    await service.answer(request);
    const log = await one("SELECT user_id, contact_id, source FROM mcp_call_log WHERE tool = 'query_records' ORDER BY id DESC LIMIT 1");
    assert.deepEqual([log.user_id, Number(log.contact_id), Number(log.source)], [null, askerId, McpCallSource.Assistant]);

    const rig = await connectTestClient({ userId: 1, tenantId: 1, fullName: "QT", email: "q@x", role: UserRole.Admin, groupIds: null }, { db, level: McpAccessLevel.ReadWrite });
    try {
      const names = (await rig.client.listTools()).tools.map((item) => item.name);
      const relationshipTools = [...WRITE_ACTIONS.values()].filter((action) => action.permission === "relationship").map((action) => action.tool);
      assert.deepEqual(names.filter((name) => relationshipTools.includes(name)), [], "cổng ngoài không thấy thao tác quan hệ");
      await rig.client.callTool({ name: "describe_entities", arguments: {} });
      assert.ok(rig.logs.length > 0 && rig.logs.every((entry) => (entry.contactId ?? null) === null && entry.source === McpCallSource.Http));
    } finally {
      await rig.close();
    }
  });

  // ------------------------------------------------------------------ Bộ phân giải tên
  test("bộ phân giải người cho CÙNG kết quả với resolveAssignee (một / nhiều / không; ưu tiên thành viên nhóm; bỏ xưng hô)", async () => {
    const people: [string, string, number][] = [["u-m1", "Minh An", groupA], ["u-m2", "Minh Bình", groupB], ["u-nam", "Nam", groupA], ["u-thu", "Thư Nguyễn", groupB], ["u-thu2", "Thư Trần", groupB]];
    for (const [uid, name, group] of people) {
      await insertContact(uid, name);
      await db.query("INSERT INTO group_member (group_id, zalo_uid, display_name) VALUES (?, ?, ?)", [group, uid, name]);
    }
    const names = ["Minh", "anh Nam", "Bình", "Xyz", "Minh An", "chị Thư", "Thư Trần", "em Minh Bình"];
    const hint = "giao <tên>: <việc>";
    let compared = 0;
    for (const groupId of [null, groupA, groupB]) {
      const ctx = buildTaskContext({ db }, { contact: { id: 1, uid: "u-x", name: "X", role: 0, kind: 2 }, threadId: groupId, messageId: null, groupId });
      for (const raw of names) {
        const old = await resolveAssignee(ctx, raw, hint);
        const next = await resolvePersonName(db, raw, { groupId });
        if ("party" in old) {
          assert.equal(next.kind, "one", `${raw}/${groupId}`);
          if (next.kind === "one") assert.deepEqual({ contactId: next.contact.id, uid: next.contact.uid, name: next.contact.name }, old.party);
        } else if (next.kind === "many") {
          assert.equal(describeContactChoices(next.choices, next.name, hint), old.reply, `${raw}/${groupId}`);
        } else {
          assert.equal(next.kind, "none", `${raw}/${groupId}`);
          assert.match(old.reply, /^Em không tìm thấy ai tên/);
        }
        compared += 1;
      }
    }
    assert.equal(compared, names.length * 3);
    // scope (MCP ngoài): chỉ người ở nhóm trong phạm vi
    const scope = contactScopeSql({ userId: 1, tenantId: 1, fullName: "x", email: "", role: UserRole.Manager, groupIds: [groupA] });
    const scoped = await resolvePersonName(db, "Minh", { scope });
    assert.ok(scoped.kind === "one" && scoped.contact.uid === "u-m1", "Minh Bình ở nhóm ngoài phạm vi nên không lộ");
    assert.equal((await resolvePersonName(db, "Thư", { scope })).kind, "none");
  });

  test("bộ phân giải nhóm: tên / nhãn, gập dấu, phạm vi, nhóm Mật cần cờ", async () => {
    const principal = (groupIds: number[] | null, canViewConfidential = false) => ({ userId: 9, tenantId: 1, fullName: "x", email: "", role: UserRole.Manager, groupIds, canViewConfidential });
    const ctx = (groupIds: number[] | null, confidential = false) => buildDataAccessContext({ db, principal: principal(groupIds, confidential), maskPersonal: false, source: McpCallSource.Assistant, now: NOW });
    const idOf = async (c: DataAccessContext, name: string) => { const r = await resolveGroupName(c, name); return r.kind === "one" ? r.group.id : r.kind; };
    assert.equal(await idOf(ctx(null), "k52"), groupA, "theo nhãn, không phân biệt hoa thường");
    assert.equal(await idOf(ctx(null), "kho can tho"), groupA, "gập dấu");
    assert.equal(await idOf(ctx(null), "Kế toán"), groupB);
    assert.equal(await idOf(ctx([groupA]), "Kế toán"), "none", "ngoài phạm vi: không lộ");
    assert.equal(await idOf(ctx(null), "ban giám đốc"), "confidential");
    assert.equal(await idOf(ctx([groupA]), "ban giám đốc"), "none", "Mật nhưng cũng ngoài phạm vi: không lộ là có");
    assert.equal(await idOf(ctx(null, true), "ban giám đốc"), secretGroup);
    assert.equal(await idOf(ctx(null), "K"), "many");
    await assert.rejects(requireOneGroup(ctx(null), "ban giám đốc"), (error: unknown) => (error as { code?: string }).code === "confidential");
  });

  // ------------------------------------------------------------------ Test vàng: việc
  test("VÀNG việc: decideTaskRelationship == task-permissions + buildTaskContext trên vai × người nhận × nguồn × quan hệ × nhóm", async () => {
    let compared = 0;
    for (const role of ROLES) {
      for (const recipient of ["none", "active", "inactive"] as const) {
        for (const origin of ORIGINS) {
          const uid = `u-t-${seq++}`;
          const contactId = await insertContact(uid, uid, role);
          if (recipient !== "none") await db.query("INSERT INTO recipient (contact_id, name, is_active) VALUES (?, ?, ?)", [contactId, uid, recipient === "active" ? 1 : 0]);
          const contact = { id: contactId, uid, name: uid, role, kind: 2 };
          for (const groupId of [null, groupA]) {
            const actor = buildContactActor(db, { contact, origin, groupId });
            const oldCtx = buildTaskContext({ db }, { contact, threadId: groupId, messageId: null, groupId, access: async () => ({ origin }) as AskerAccess });
            const viewer: TaskViewer = { uid, contactId, overseer: await oldCtx.isOverseer(), groupId };
            assert.equal(await actor.facts.isTaskOverseer(), viewer.overseer, `sếp: role=${role} recipient=${recipient} origin=${origin}`);
            const mine = { contactId, uid, name: "tôi" };
            const other = { contactId: contactId + 1000, uid: "u-other", name: "người khác" };
            const parties: [string, TaskRow["assigner"], TaskRow["assignee"]][] = [
              ["giao-uid", { ...mine, contactId: null }, null], ["giao-id", { ...mine, uid: null }, other], ["giao-cả", mine, other],
              ["nhận-uid", other, { ...mine, contactId: null }], ["nhận-id", other, { ...mine, uid: null }], ["nhận-cả", other, mine],
              ["người-lạ", other, other], ["không-người-nhận", other, null], ["uid-rỗng", { contactId: null, uid: "", name: "" }, null],
            ];
            for (const [label, assigner, assignee] of parties) {
              for (const sourceThreadId of [groupA, groupB, null]) {
                const task = { assigner, assignee, source_thread_id: sourceThreadId } as TaskRow;
                const next = decideTaskRelationship(actor, await actor.facts.isTaskOverseer(), { assigner, assignee, sourceThreadId });
                const where = `${label} role=${role} recipient=${recipient} origin=${origin} nhóm=${groupId} nguồn=${sourceThreadId}`;
                assert.deepEqual(next, {
                  isAssigner: isTaskAssigner(viewer, task), isAssignee: isTaskAssignee(viewer, task), canView: canViewTask(viewer, task),
                  canWork: canWorkOnTask(viewer, task), canManage: canManageTask(viewer, task),
                }, where);
                compared += 1;
              }
            }
          }
        }
      }
    }
    assert.equal(compared, 3 * 3 * 4 * 2 * 9 * 3);
  });

  // ------------------------------------------------------------------ Test vàng: ticket
  test("VÀNG ticket: decideTicketRelationship == runTicketCommand (câu trả lời cũ) trên vai × người xử lý × nguồn × quan hệ × cuộc × nhóm Mật", async () => {
    const requesterUid = "u-req";
    await insertContact(requesterUid, "Người báo");
    const askerAccess = (origin: AskerOrigin, uid: string): AskerAccess => {
      const principal = { userId: origin === "web_user" ? 5 : null, tenantId: 1, fullName: uid, email: "", role: UserRole.Manager, groupIds: null, canViewConfidential: false };
      return { ...buildDataAccessContext({ db, principal, maskPersonal: false, source: McpCallSource.Assistant, now: NOW }), origin };
    };
    const commands: Record<TicketAction, (id: number) => TicketCommand> = {
      status: (ticketId) => ({ kind: "ticket_status", ticketId }), accept: (ticketId) => ({ kind: "ticket_accept", ticketId }),
      done: (ticketId) => ({ kind: "ticket_done", ticketId, note: "xong" }), cancel: (ticketId) => ({ kind: "ticket_cancel", ticketId, note: "hủy" }),
      note: (ticketId) => ({ kind: "ticket_note", ticketId, note: "ghi chú" }),
    };
    const classify = (action: TicketAction, reply: string): { reason: string; asRequester?: boolean; fromRequester?: boolean } => {
      if (/^Em không thấy ticket/.test(reply)) return { reason: "not_found" };
      if (/^Chỉ người xử lý ticket mới nhận/.test(reply)) return { reason: "handler_only" };
      if (/^Chỉ người xử lý ticket \(hoặc chính người báo\)/.test(reply)) return { reason: "handler_or_requester" };
      if (action === "done") return { reason: "ok", asRequester: /^Dạ em đã đóng/.test(reply) };
      if (action === "note") return { reason: "ok", fromRequester: /^Dạ em đã thêm vào/.test(reply) };
      return { reason: "ok" };
    };
    let compared = 0;
    for (const role of ROLES) {
      for (const handler of [false, true]) {
        for (const origin of ["web_user", "derived_role", "disabled_account"] as AskerOrigin[]) {
          const uid = `u-k-${seq++}`;
          const contactId = await insertContact(uid, uid, role);
          if (handler) await db.query("INSERT INTO ticket_handler (contact_id) VALUES (?)", [contactId]);
          const contact = { id: contactId, uid, name: uid, role, kind: 2 };
          const actor = buildContactActor(db, { contact, origin });
          assert.equal(await actor.facts.isTicketHandler(), handler);
          for (const relation of ["requester", "stranger"] as const) {
            for (const groupId of [null, groupA]) {
              for (const sourceThread of [groupA, groupB, secretGroup]) {
                for (const action of Object.keys(commands) as TicketAction[]) {
                  const reqUid = relation === "requester" ? uid : requesterUid;
                  const [inserted] = await db.query<any>(
                    "INSERT INTO ticket (code, status, title, body, requester_uid, requester_name, source_thread_id, bot_account_id) VALUES (?, ?, 't', 'nội dung', ?, 'Người báo', ?, 1)",
                    [`~k${seq++}`, TicketStatus.New, reqUid, sourceThread]);
                  const ticketId = inserted.insertId as number;
                  const access = askerAccess(origin, uid);
                  const oldCtx = buildTicketContext({ db }, { contact: { id: contactId, uid, name: uid, role }, threadId: groupId ?? 1, messageId: null, botAccountId: 1, scopeGroupId: groupId ?? undefined, access: async () => access });
                  const reply = await runTicketCommand(oldCtx, commands[action](ticketId), NOW);
                  const visible = await isTicketVisible(db, ticketId, await overseerPart(oldCtx));
                  const next = decideTicketRelationship(
                    { uid, groupId }, { handler: await actor.facts.isTicketHandler(), overseer: await actor.facts.isTicketOverseer() },
                    { requesterUid: reqUid, sourceThreadId: sourceThread, visibleToOverseer: visible }, action);
                  const old = classify(action, reply);
                  const where = `${action} role=${role} handler=${handler} origin=${origin} ${relation} nhóm=${groupId} nguồn=${sourceThread}`;
                  assert.equal(next.ok ? "ok" : next.reason, old.reason, `${where} :: ${reply}`);
                  if (next.ok && action === "done") assert.equal(next.asRequester, old.asRequester, where);
                  if (next.ok && action === "note") assert.equal(next.isRequester, old.fromRequester, where);
                  compared += 1;
                }
              }
            }
          }
        }
      }
    }
    assert.equal(compared, 3 * 2 * 3 * 2 * 2 * 3 * 5);
  });
});
