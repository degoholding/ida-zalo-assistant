// Phase 8 — ghi qua MCP / trợ lý (nháp → mã → confirm_write) trên MySQL THẬT: từng công cụ ghi + audit đúng người, ràng buộc mã
// (khóa / người / hết hạn / dùng hai lần / sửa payload), đích đổi giữa chừng, hạ quyền giữa chừng, phạm vi + Mật, nhịp, luật «tin sau» của trợ lý,
// và luồng đầy đủ qua máy chủ MCP trong tiến trình. Dữ liệu có tiền tố `w8-` và tự dọn.
//
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_p8 npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import type { Principal } from "../src/auth/principal.js";
import { McpAccessLevel, McpCallSource, ReplyTemplateStatus, TaskStatus, TicketStatus, UserRole } from "../src/constants.js";
import { buildDataAccessContext, type DataAccessContext } from "../src/data-access/data-access-context.js";
import { findTool } from "../src/data-access/read-tool-catalog.js";
import { runTool, type ToolResult } from "../src/data-access/tool-runner.js";
import { createDraft, MAX_OPEN_DRAFTS_PER_USER, MAX_PROPOSALS_PER_MINUTE } from "../src/data-access/write/write-draft-store.js";
import { WRITE_ACTIONS } from "../src/data-access/write/write-tool-catalog.js";
import { acceptTicket, findTicket, TicketActionError } from "../src/tickets/ticket-service.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { connectTestClient } from "../src/mcp/mcp-test-support.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const PREFIX = "w8-";
const NOW = new Date("2026-10-17T05:00:00Z");

const principal = (role: UserRole, overrides: Partial<Principal> = {}): Principal =>
  ({ userId: 901, tenantId: 1, fullName: "Quản Lý Thử", email: "ql@example.com", role, groupIds: null, ...overrides });

describe("ghi qua MCP / trợ lý: nháp → confirm_write (MySQL)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let groupId = 0;
  let otherGroupId = 0;
  let secretGroupId = 0;
  let contactId = 0;
  let outsiderContactId = 0;
  let companyId = 0;

  const ctxOf = (who: Principal, overrides: Partial<DataAccessContext> & { confidential?: boolean } = {}): DataAccessContext => {
    const { confidential, ...rest } = overrides;
    const base = buildDataAccessContext({
      db, principal: confidential ? { ...who, canViewConfidential: true } : who, allowWrite: true, maskPersonal: false, source: McpCallSource.Http, keyId: 5, now: NOW,
    });
    return { ...base, ...rest };
  };
  const call = (name: string, args: unknown, ctx: DataAccessContext): Promise<ToolResult> => runTool(findTool(name)!, ctx, args);
  const manager = () => principal(UserRole.Manager);

  /** Đề xuất + lấy mã (đòi thành công). */
  async function propose(name: string, args: unknown, ctx = ctxOf(manager())): Promise<string> {
    const result = await call(name, args, ctx);
    assert.equal(result.isError, false, result.text);
    return (result.structured as { draft: { code: string } }).draft.code;
  }
  const confirm = (code: string, ctx = ctxOf(manager())) => call("confirm_write", { code }, ctx);
  const errorOf = (result: ToolResult) => (result.isError ? result.errorCode : "ok");

  async function lastAudit(entity: string, entityId: number): Promise<RowDataPacket | undefined> {
    const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT 1", [entity, entityId]);
    return rows[0];
  }
  const one = async (sql: string, params: unknown[] = []): Promise<RowDataPacket> => ((await db.query<RowDataPacket[]>(sql, params))[0][0]);

  async function insertTask(title: string, threadId: number | null = groupId): Promise<number> {
    const [result] = await db.query<any>(
      "INSERT INTO task (code, status, priority, title, assigner_name, source, source_thread_id, confirmed_at) VALUES (?, ?, 2, ?, 'Ai đó', 1, ?, NOW(3))",
      [`~${PREFIX}${Math.random().toString(36).slice(2, 10)}`, TaskStatus.Open, `${PREFIX}${title}`, threadId]);
    return result.insertId;
  }
  async function insertTicket(title: string, threadId: number | null = groupId): Promise<number> {
    const [result] = await db.query<any>(
      "INSERT INTO ticket (code, status, title, body, requester_uid, requester_name, source_thread_id) VALUES (?, ?, ?, 'nội dung', ?, 'Khách', ?)",
      [`~${PREFIX}${Math.random().toString(36).slice(2, 10)}`, TicketStatus.New, `${PREFIX}${title}`, `${PREFIX}req`, threadId]);
    return result.insertId;
  }

  async function cleanup(): Promise<void> {
    await db.query("DELETE FROM mcp_write_draft");
    await db.query("DELETE FROM task_event WHERE task_id IN (SELECT id FROM task WHERE title LIKE ?)", [`${PREFIX}%`]);
    await db.query("DELETE FROM task WHERE title LIKE ?", [`${PREFIX}%`]);
    await db.query("DELETE FROM ticket_event WHERE ticket_id IN (SELECT id FROM ticket WHERE title LIKE ?)", [`${PREFIX}%`]);
    await db.query("DELETE FROM ticket WHERE title LIKE ?", [`${PREFIX}%`]);
    await db.query("DELETE FROM reply_template WHERE name LIKE ?", [`${PREFIX}%`]);
    await db.query("DELETE FROM group_member WHERE zalo_uid LIKE ?", [`${PREFIX}%`]);
    await db.query("DELETE FROM contact WHERE zalo_uid LIKE ?", [`${PREFIX}%`]);
    await db.query("DELETE FROM zalo_group WHERE zalo_group_id LIKE ?", [`${PREFIX}%`]);
    await db.query("DELETE FROM company WHERE code LIKE ?", [`${PREFIX}%`]);
    await db.query("DELETE FROM job");
    await db.query("DELETE FROM audit_log WHERE actor LIKE '%Quản Lý Thử%' OR actor LIKE '%Admin Thử%'");
  }

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    await cleanup();
    const insertGroup = async (suffix: string, confidential: number) => ((await db.query<any>(
      "INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages, is_confidential) VALUES (1, ?, ?, 1, ?)", [`${PREFIX}${suffix}`, `Nhóm ${suffix}`, confidential]))[0] as any).insertId as number;
    groupId = await insertGroup("g1", 0);
    otherGroupId = await insertGroup("g2", 0);
    secretGroupId = await insertGroup("secret", 1);
    const insertContact = async (suffix: string, inGroup: number) => {
      const [result] = await db.query<any>("INSERT INTO contact (zalo_uid, zalo_name, display_name, note) VALUES (?, ?, ?, 'ghi chú cũ')", [`${PREFIX}${suffix}`, `Zalo ${suffix}`, `Người ${suffix}`]);
      await db.query("INSERT INTO group_member (group_id, zalo_uid) VALUES (?, ?)", [inGroup, `${PREFIX}${suffix}`]);
      return result.insertId as number;
    };
    contactId = await insertContact("c1", groupId);
    outsiderContactId = await insertContact("c2", otherGroupId);
    companyId = ((await db.query<any>("INSERT INTO company (code, name) VALUES (?, 'Công ty thử')", [`${PREFIX}co`]))[0] as any).insertId;
  });

  after(async () => {
    if (db) {
      await cleanup();
      await db.end();
    }
  });

  beforeEach(async () => {
    await db.query("DELETE FROM mcp_write_draft");
  });

  test("propose_contact_update → confirm_write: sửa hồ sơ, audit_log.actor = «<tên> · MCP», vai trò + loại không đổi", async () => {
    const before = await one("SELECT role, kind, kind_source FROM contact WHERE id = ?", [contactId]);
    const code = await propose("propose_contact_update", { contact_id: contactId, note: "khách VIP", tags: ["vip", "hcm"], company_id: companyId });
    assert.match(code, /^[2-9A-HJKMNP-Z]{6}$/);
    // Chưa xác nhận: dữ liệu CHƯA đổi
    assert.equal((await one("SELECT note FROM contact WHERE id = ?", [contactId])).note, "ghi chú cũ");
    const result = await confirm(code);
    assert.equal(result.isError, false, result.text);
    assert.deepEqual((result.structured as { changed_fields: string[] }).changed_fields.sort(), ["Công ty", "Ghi chú", "Thẻ"].sort());
    const row = await one("SELECT kind, kind_source, note, company_id, role FROM contact WHERE id = ?", [contactId]);
    // D2: AI không đặt loại — kind_source giữ nguyên (không bị đánh dấu «chỉnh tay»); chế độ «tự động» vẫn tự suy lại loại từ nhóm như mọi lần lưu hồ sơ trên web
    assert.deepEqual([Number(row.kind_source), row.note, Number(row.company_id), Number(row.role)],
      [Number(before.kind_source), "khách VIP", companyId, Number(before.role)], "D2: loại (kind) không bị đặt tay");
    const audit = await lastAudit("contact", contactId);
    assert.equal(audit?.actor, "Quản Lý Thử · MCP");
    assert.match(String(audit?.changed_fields), /Ghi chú/);
  });

  test("propose_group_update → confirm_write: đổi tên gọi, cờ Mật / đọc tin không đổi, audit đúng người", async () => {
    const code = await propose("propose_group_update", { group_id: groupId, label: "Nhóm đã đổi tên", company_id: companyId });
    await confirm(code);
    const row = await one("SELECT label, company_id, read_messages, is_confidential FROM zalo_group WHERE id = ?", [groupId]);
    assert.deepEqual([row.label, Number(row.company_id), Number(row.read_messages), Number(row.is_confidential)], ["Nhóm đã đổi tên", companyId, 1, 0]);
    assert.equal((await lastAudit("group", groupId))?.actor, "Quản Lý Thử · MCP");
  });

  test("task: tạo mới + báo xong qua task-service, audit đúng người; đích đổi giữa chừng → stale_target (không ghi đè)", async () => {
    const createCode = await propose("propose_task_create", { title: `${PREFIX}Gửi báo giá`, assignee_contact_id: contactId, due_date: "2026-10-20", source_thread_id: groupId });
    const created = await confirm(createCode);
    assert.equal(created.isError, false, created.text);
    const taskId = (created.structured as { id: number }).id;
    const task = await one("SELECT status, assignee_contact_id, source, source_thread_id FROM task WHERE id = ?", [taskId]);
    assert.deepEqual([Number(task.status), Number(task.assignee_contact_id), Number(task.source_thread_id)], [TaskStatus.Open, contactId, groupId]);
    assert.equal((await lastAudit("task", taskId))?.actor, "Quản Lý Thử · MCP");
    // Người phụ trách được báo qua hàng đợi Zalo? (job/tin xếp hàng do task-service — ở đây chỉ cần không lỗi)

    const finishCode = await propose("propose_task_update", { task_id: taskId, action: "finish", note: "xong rồi" });
    const finished = await confirm(finishCode);
    assert.equal(finished.isError, false, finished.text);
    assert.equal(Number((await one("SELECT status FROM task WHERE id = ?", [taskId])).status), TaskStatus.Done);
    assert.match(String((await lastAudit("task", taskId))?.message), /Báo xong/);

    // Stale: đề xuất mở lại, rồi ai đó đổi việc trước khi xác nhận
    const reopenCode = await propose("propose_task_update", { task_id: taskId, action: "reopen" });
    await db.query("UPDATE task SET status = ?, closed_at = NULL WHERE id = ?", [TaskStatus.Open, taskId]);
    const stale = await confirm(reopenCode);
    assert.equal(errorOf(stale), "stale_target");
    assert.match(stale.text, /đã thay đổi/);
  });

  test("ticket: nhận xử lý qua ticket-service + audit; ngoài phạm vi nhóm → not_found", async () => {
    const ticketId = await insertTicket("Lỗi in");
    const code = await propose("propose_ticket_action", { ticket_id: ticketId, action: "accept" });
    const result = await confirm(code);
    assert.equal(result.isError, false, result.text);
    assert.equal(Number((await one("SELECT status FROM ticket WHERE id = ?", [ticketId])).status), TicketStatus.InProgress);
    assert.equal((await lastAudit("ticket", ticketId))?.actor, "Quản Lý Thử · MCP");
    const scoped = ctxOf(principal(UserRole.Manager, { groupIds: [otherGroupId] }));
    assert.equal(errorOf(await call("propose_ticket_action", { ticket_id: ticketId, action: "note", note: "x" }, scoped)), "not_found");
  });

  test("mẫu tin: Quản trị soạn qua AI → luôn «Chờ duyệt»; sửa mẫu của mình không tự «Đã duyệt»; mẫu người khác → forbidden", async () => {
    const adminWho = principal(UserRole.Admin, { userId: 902, fullName: "Admin Thử" });
    const code = await propose("propose_reply_template_save", { title: `${PREFIX}Chào khách`, situation: "khách hỏi giá", body: "Dạ em gửi anh chị bảng giá ạ.", tone: 2 }, ctxOf(adminWho));
    const created = await confirm(code, ctxOf(adminWho));
    const id = (created.structured as { id: number }).id;
    assert.equal(Number((await one("SELECT status FROM reply_template WHERE id = ?", [id])).status), ReplyTemplateStatus.PendingReview);
    await db.query("UPDATE reply_template SET status = ? WHERE id = ?", [ReplyTemplateStatus.Approved, id]);
    const editCode = await propose("propose_reply_template_save", { id, title: `${PREFIX}Chào khách 2`, body: "Dạ em gửi anh chị bảng giá mới ạ.", tone: 2 }, ctxOf(adminWho));
    assert.equal((await confirm(editCode, ctxOf(adminWho))).isError, false);
    assert.equal(Number((await one("SELECT status FROM reply_template WHERE id = ?", [id])).status), ReplyTemplateStatus.PendingReview, "sửa mẫu đã duyệt qua AI phải về Chờ duyệt");
    assert.equal((await lastAudit("reply_template", id))?.actor, "Admin Thử · MCP");
    const other = await call("propose_reply_template_save", { id, title: `${PREFIX}Cướp`, body: "Nội dung của người khác" }, ctxOf(principal(UserRole.Staff, { userId: 903 })));
    assert.equal(errorOf(other), "forbidden");
  });

  test("ràng buộc mã: sai khóa / sai người / sai nguồn → invalid_code; dùng hai lần → invalid_code; hết hạn → invalid_code", async () => {
    const make = () => propose("propose_contact_update", { contact_id: contactId, note: `n${Math.random()}` });
    const wrongKey = await make();
    assert.equal(errorOf(await confirm(wrongKey, ctxOf(manager(), { keyId: 6 }))), "invalid_code");
    assert.equal(errorOf(await confirm(wrongKey, ctxOf(principal(UserRole.Manager, { userId: 777 })))), "invalid_code");
    assert.equal(errorOf(await confirm(wrongKey, ctxOf(manager(), { source: McpCallSource.Assistant, keyId: null }))), "forbidden", "trợ lý không có confirm_write");
    assert.equal(errorOf(await confirm(wrongKey.toLowerCase().split("").join(" "))), "ok", "mã gõ chữ thường / có khoảng trắng vẫn khớp");
    assert.equal(errorOf(await confirm(wrongKey)), "invalid_code", "dùng hai lần");
    const late = await make();
    assert.equal(errorOf(await confirm(late, ctxOf(manager(), { now: new Date(NOW.getTime() + 10 * 60_000 + 1) }))), "invalid_code", "quá 10 phút");
    assert.equal(errorOf(await confirm("ZZZZZZ")), "invalid_code");
  });

  test("hai lần xác nhận song song: đúng một lần ghi (UPDATE nguyên tử)", async () => {
    const taskId = await insertTask("song song");
    const code = await propose("propose_task_update", { task_id: taskId, action: "note", note: "ghi chú song song" });
    const results = await Promise.all([confirm(code), confirm(code)]);
    assert.deepEqual(results.map(errorOf).sort(), ["invalid_code", "ok"]);
    const [events] = await db.query<RowDataPacket[]>("SELECT id FROM task_event WHERE task_id = ? AND note = 'ghi chú song song'", [taskId]);
    assert.equal(events.length, 1);
  });

  test("sửa payload nháp trong DB → băm không khớp → invalid_code, dữ liệu không đổi", async () => {
    const code = await propose("propose_contact_update", { contact_id: contactId, note: "bản gốc" });
    await db.query("UPDATE mcp_write_draft SET payload_json = JSON_SET(payload_json, '$.args.note', 'bản bị sửa')");
    assert.equal(errorOf(await confirm(code)), "invalid_code");
    assert.notEqual((await one("SELECT note FROM contact WHERE id = ?", [contactId])).note, "bản bị sửa");
  });

  test("hạ quyền giữa chừng: Quản lý đề xuất, sau đó chỉ còn quyền Nhân viên → confirm bị từ chối, không ghi", async () => {
    const code = await propose("propose_contact_update", { contact_id: contactId, note: "sau khi hạ quyền" });
    const downgraded = ctxOf(principal(UserRole.Staff));
    assert.equal(errorOf(await confirm(code, downgraded)), "forbidden");
    const shrunk = ctxOf(principal(UserRole.Manager, { groupIds: [otherGroupId] }));
    assert.equal(errorOf(await confirm(code, shrunk)), "not_found", "bị thu hẹp phạm vi nhóm giữa chừng");
    assert.notEqual((await one("SELECT note FROM contact WHERE id = ?", [contactId])).note, "sau khi hạ quyền");
    assert.equal(errorOf(await confirm(code)), "ok", "nháp vẫn còn dùng được khi quyền đủ lại");
  });

  test("phạm vi + Mật: người ngoài phạm vi nhóm → not_found; nhóm Mật cần cờ Mật", async () => {
    const scoped = ctxOf(principal(UserRole.Manager, { groupIds: [groupId, secretGroupId] }));
    assert.equal(errorOf(await call("propose_contact_update", { contact_id: outsiderContactId, note: "x" }, scoped)), "not_found");
    assert.equal(errorOf(await call("propose_group_update", { group_id: secretGroupId, label: "bí mật" }, scoped)), "not_found");
    const withFlag = ctxOf(principal(UserRole.Manager, { groupIds: [groupId, secretGroupId] }), { confidential: true });
    assert.equal(errorOf(await call("propose_group_update", { group_id: secretGroupId, label: "bí mật" }, withFlag)), "ok");
    const taskInSecret = await insertTask("trong nhóm mật", secretGroupId);
    assert.equal(errorOf(await call("propose_task_update", { task_id: taskInSecret, action: "cancel" }, scoped)), "not_found");
  });

  test("không có thay đổi thật → invalid_value; kind không nhận (D2); liên hệ không tồn tại → not_found", async () => {
    await db.query("UPDATE contact SET note = 'cố định' WHERE id = ?", [contactId]);
    assert.equal(errorOf(await call("propose_contact_update", { contact_id: contactId, note: "cố định" }, ctxOf(manager()))), "invalid_value");
    assert.equal(errorOf(await call("propose_contact_update", { contact_id: outsiderContactId, kind: 1 }, ctxOf(manager()))), "invalid_value", "D2");
    assert.equal(errorOf(await call("propose_contact_update", { contact_id: outsiderContactId, note: "khác" }, ctxOf(manager()))), "ok");
    assert.equal(errorOf(await call("propose_contact_update", { contact_id: 999_999_999, note: "x" }, ctxOf(manager()))), "not_found");
  });

  test(`nhịp: tối đa ${MAX_PROPOSALS_PER_MINUTE} đề xuất / phút / khóa; khóa khác không bị ảnh hưởng`, async () => {
    for (let i = 0; i < MAX_PROPOSALS_PER_MINUTE; i++) await propose("propose_contact_update", { contact_id: contactId, note: `nhịp ${i}` });
    assert.equal(errorOf(await call("propose_contact_update", { contact_id: contactId, note: "thừa" }, ctxOf(manager()))), "rate_limited");
    assert.equal(errorOf(await call("propose_contact_update", { contact_id: contactId, note: "khóa khác" }, ctxOf(manager(), { keyId: 6 }))), "ok");
  });

  test("trợ lý không xác nhận bằng công cụ: confirm_write với nguồn trợ lý → forbidden dù nháp của chính nó; nháp MCP không dùng được ở trợ lý", async () => {
    const assistantCtx = (now: Date) => ctxOf(manager(), { source: McpCallSource.Assistant, keyId: null, now });
    const code = await propose("propose_contact_update", { contact_id: contactId, note: "qua trợ lý" }, assistantCtx(NOW));
    assert.equal(errorOf(await confirm(code, assistantCtx(new Date(NOW.getTime() + 60_000)))), "forbidden");
    assert.notEqual((await one("SELECT note FROM contact WHERE id = ?", [contactId])).note, "qua trợ lý");
    const mcpCode = await propose("propose_contact_update", { contact_id: contactId, note: "mcp" });
    assert.equal(errorOf(await confirm(mcpCode, assistantCtx(NOW))), "forbidden");
  });

  // ---- Vá sau review phase 8 ----

  test("H2: che dữ liệu cá nhân bật → note_append giữ nguyên ghi chú cũ (kể cả số thật), thay cả ghi chú bằng chữ che bị từ chối", async () => {
    await db.query("UPDATE contact SET note = 'gọi 0912345678 sau 5h' WHERE id = ?", [contactId]);
    const masked = () => ctxOf(manager(), { maskPersonal: true });
    const rejected = await call("propose_contact_update", { contact_id: contactId, note: "gọi [SĐT ***678] sau 5h" }, masked());
    assert.equal(errorOf(rejected), "invalid_value");
    const code = await propose("propose_contact_update", { contact_id: contactId, note_append: "đã báo giá" }, masked());
    assert.equal((await confirm(code, masked())).isError, false);
    assert.equal((await one("SELECT note FROM contact WHERE id = ?", [contactId])).note, "gọi 0912345678 sau 5h\nđã báo giá", "số thật còn nguyên");
  });

  test("M1: execute kiểm lại dấu trạng thái TRONG khóa dòng — đích bị đổi sát lúc ghi → stale_target, dữ liệu không bị ghi đè (contact / nhóm / mẫu tin / ticket)", async () => {
    const exec = (tool: string, payload: unknown, state: string, ctx = ctxOf(manager())) => WRITE_ACTIONS.get(tool)!.execute(ctx, payload, state);
    const stale = (run: () => Promise<unknown>) => assert.rejects(run, (error: unknown) => (error as { code?: string }).code === "stale_target");
    await db.query("UPDATE contact SET note = 'gốc' WHERE id = ?", [contactId]);
    await stale(() => exec("propose_contact_update", { contact_id: contactId, note: "ghi đè" }, JSON.stringify([0, "người khác vừa sửa", []])));
    assert.equal((await one("SELECT note FROM contact WHERE id = ?", [contactId])).note, "gốc");
    await db.query("UPDATE zalo_group SET label = 'nhãn gốc' WHERE id = ?", [groupId]);
    await stale(() => exec("propose_group_update", { group_id: groupId, label: "ghi đè" }, JSON.stringify(["nhãn cũ hơn", 0])));
    assert.equal((await one("SELECT label FROM zalo_group WHERE id = ?", [groupId])).label, "nhãn gốc");
    const mine = principal(UserRole.Manager, { userId: 905, fullName: "Quản Lý Thử" });
    const created = await confirm(await propose("propose_reply_template_save", { title: `${PREFIX}Mẫu khóa`, body: "Dạ em gửi anh chị thông tin ạ.", tone: 2 }, ctxOf(mine)), ctxOf(mine));
    const templateId = (created.structured as { id: number }).id;
    await stale(() => exec("propose_reply_template_save", { id: templateId, title: `${PREFIX}Mẫu khóa`, body: "Nội dung ghi đè đủ dài", tone: 2, situation: "" }, "[0,\"x\",\"\",\"\",2]", ctxOf(mine)));
    assert.equal((await one("SELECT body FROM reply_template WHERE id = ?", [templateId])).body, "Dạ em gửi anh chị thông tin ạ.");
    const ticketId = await insertTicket("Ticket khóa");
    await stale(() => exec("propose_ticket_action", { ticket_id: ticketId, action: "accept" }, "9|"));
    assert.equal(Number((await one("SELECT status FROM ticket WHERE id = ?", [ticketId])).status), TicketStatus.New);
  });

  test("M1: ticket-service UPDATE kèm trạng thái — hàng đọc cũ (bộ nhớ) mà DB đã đổi → TicketActionError, không ghi đè", async () => {
    const ticketId = await insertTicket("Ticket đua");
    const stale = (await findTicket(db, ticketId))!;
    await db.query("UPDATE ticket SET status = ? WHERE id = ?", [TicketStatus.Done, ticketId]);
    await assert.rejects(acceptTicket({ db }, stale, { name: "Ai đó", contactId: null, via: "web" }), TicketActionError);
    assert.equal(Number((await one("SELECT status FROM ticket WHERE id = ?", [ticketId])).status), TicketStatus.Done);
  });

  test("M2: nháp được ĐÁNH DẤU attempted trước khi ghi; lỗi hệ thống sau đó → failed + thông báo rõ, đề xuất lại y hệt bị chặn, khác nội dung thì được", async () => {
    const action = WRITE_ACTIONS.get("propose_group_update")!;
    const original = action.execute;
    let seenDuring = "";
    action.execute = async () => {
      seenDuring = String((await one("SELECT JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.status')) AS s FROM mcp_write_draft ORDER BY id DESC LIMIT 1")).s);
      throw new Error("Zalo sập giữa chừng");
    };
    try {
      const code = await propose("propose_group_update", { group_id: groupId, label: "nhãn M2" });
      const failed = await confirm(code);
      assert.equal(errorOf(failed), "invalid_state");
      assert.match(failed.text, /lỗi giữa chừng/);
      assert.equal(seenDuring, "attempted");
      assert.equal((await one("SELECT JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.status')) AS s FROM mcp_write_draft ORDER BY id DESC LIMIT 1")).s, "failed");
      assert.equal(errorOf(await call("propose_group_update", { group_id: groupId, label: "nhãn M2" }, ctxOf(manager()))), "invalid_state", "không đề xuất lại y hệt ngay");
      assert.equal(errorOf(await call("propose_group_update", { group_id: groupId, label: "nhãn M2 khác" }, ctxOf(manager()))), "ok");
    } finally {
      action.execute = original;
    }
  });

  test("trần nháp mở đếm THEO NGUỒN: 20 nháp MCP đang mở không chặn nháp của trợ lý (và ngược lại vẫn chặn đúng nguồn)", async () => {
    for (let i = 0; i < MAX_OPEN_DRAFTS_PER_USER; i++) {
      await createDraft(db, { tenantId: 1, userId: 901, keyId: 100 + i, source: McpCallSource.Http, tool: "propose_contact_update", targetEntity: "contact", targetId: contactId,
        payload: { args: { n: i }, state: "s" }, preview: "p", now: NOW });
    }
    assert.equal(errorOf(await call("propose_contact_update", { contact_id: contactId, note: "thừa MCP" }, ctxOf(manager()))), "rate_limited");
    const assistantCtx = ctxOf(manager(), { source: McpCallSource.Assistant, keyId: null });
    assert.equal(errorOf(await call("propose_contact_update", { contact_id: contactId, note: "của trợ lý" }, assistantCtx)), "ok");
  });

  test("băm lưu là HMAC (không phải SHA-256 trần của mã)", async () => {
    const code = await propose("propose_contact_update", { contact_id: contactId, note: "băm hmac" });
    const crypto = await import("node:crypto");
    const row = await one("SELECT code_hash FROM mcp_write_draft ORDER BY id DESC LIMIT 1");
    assert.notEqual(row.code_hash, crypto.createHash("sha256").update(code).digest("hex"));
  });

  test("máy chủ MCP trong tiến trình: khóa chỉ đọc không thấy công cụ ghi; khóa đọc+ghi thấy; luồng propose → confirm đầy đủ + nhật ký gọi", async () => {
    const readRig = await connectTestClient(manager(), { db, level: McpAccessLevel.Read });
    const writeRig = await connectTestClient(manager(), { db, level: McpAccessLevel.ReadWrite });
    const staffRig = await connectTestClient(principal(UserRole.Staff, { userId: 910 }), { db, level: McpAccessLevel.ReadWrite });
    try {
      const nameOf = async (rig: typeof readRig) => (await rig.client.listTools()).tools.map((tool) => tool.name);
      assert.ok((await nameOf(readRig)).every((name) => !/^propose_|^confirm_write$/.test(name)));
      const writeTools = await writeRig.client.listTools();
      assert.equal(writeTools.tools.filter((tool) => /^propose_/.test(tool.name)).length, 6);
      assert.equal(writeTools.tools.find((tool) => tool.name === "confirm_write")?.annotations?.destructiveHint, true);
      assert.deepEqual((await nameOf(staffRig)).filter((name) => /^propose_|^confirm_write$/.test(name)), [], "D3: Nhân viên chỉ đọc qua AI");

      const proposal = await writeRig.client.callTool({ name: "propose_contact_update", arguments: { contact_id: contactId, note: "qua MCP thật" } });
      assert.ok(!proposal.isError, JSON.stringify(proposal));
      const draft = (proposal.structuredContent as { draft: { code: string; preview: string } }).draft;
      assert.match(draft.preview, /qua MCP thật/);
      const confirmed = await writeRig.client.callTool({ name: "confirm_write", arguments: { code: draft.code } });
      assert.ok(!confirmed.isError, JSON.stringify(confirmed));
      assert.equal((await one("SELECT note FROM contact WHERE id = ?", [contactId])).note, "qua MCP thật");
      assert.equal((await lastAudit("contact", contactId))?.actor, "Quản Lý Thử · MCP");
      assert.deepEqual(writeRig.logs.map((entry) => entry.tool), ["propose_contact_update", "confirm_write"]);
      // Khóa chỉ đọc gọi thẳng tên công cụ ghi → bị chặn
      const blocked = await readRig.client.callTool({ name: "confirm_write", arguments: { code: draft.code } }).catch((error: unknown) => ({ isError: true, error }));
      assert.equal((blocked as { isError?: boolean }).isError, true);
    } finally {
      await Promise.all([readRig.close(), writeRig.close(), staffRig.close()]);
    }
  });
});
