// Phase 9 — ma trận phạm vi của lõi truy cập dữ liệu trên MySQL THẬT: Principal nạp từ `app_user` thật (loadUserPrincipal) × nhóm
// thường / nhóm khác / nhóm Mật / cuộc riêng → query_records (groups, messages, files, contacts, tickets, audit_log), get_file_text,
// search_messages. Ngoài phạm vi = not_found hoặc 0 dòng, không bao giờ lộ.
//
// Chạy: TEST_DATABASE_URL=mysql://root:...@127.0.0.1:3308/bot_tro_ly_test_p9 npm test

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { loadUserPrincipal, type Principal } from "../src/auth/principal.js";
import { UserRole } from "../src/constants.js";
import { makeCtx } from "../src/data-access/data-access-test-support.js";
import { findTool } from "../src/data-access/read-tool-catalog.js";
import { runTool, type ToolResult } from "../src/data-access/tool-runner.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { ensureGroup, updateGroupSettings } from "../src/sync/group-repository.js";
import { ingestGroupMessage } from "../src/sync/message-ingest.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["audit_log", "ticket_event", "ticket", "attachment_text", "attachment", "message_search", "message", "group_member", "bot_group", "zalo_group",
  "contact", "bot_account", "user_group_scope", "app_user"];
const KEYWORD = "congnoxyz";
const NOW_MS = Date.parse("2026-10-10T05:00:00Z");

describe("ma trận phạm vi lõi truy cập dữ liệu (MySQL)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  const gid: Record<string, number> = {};
  const fid: Record<string, number> = {};
  const people: Record<string, Principal> = {};

  async function addUser(name: string, role: UserRole, options: { groups?: number[]; allGroups?: boolean; audit?: boolean } = {}): Promise<Principal> {
    const [result] = await db.query<any>(
      "INSERT INTO app_user (email, username, full_name, role, all_groups, can_view_audit, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)",
      [`${name}@ida.vn`, name, name, role, options.allGroups ? 1 : 0, options.audit ? 1 : 0]);
    for (const groupId of options.groups ?? []) await db.query("INSERT INTO user_group_scope (user_id, group_id) VALUES (?, ?)", [result.insertId, groupId]);
    return (await loadUserPrincipal(db, result.insertId))!;
  }

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    const [bot] = await db.query<any>("INSERT INTO bot_account (label, zalo_uid, session_cipher) VALUES ('bot1', 'u-bot', 'x')");
    const deps = { db, defaults: { readMessages: true, captureFiles: true } };
    for (const [key, zaloId] of [["a", "g-a"], ["b", "g-b"], ["mat", "g-mat"]] as const) {
      const { group } = await ensureGroup(db, zaloId, { readMessages: true, captureFiles: true });
      gid[key] = group.id;
      await db.query("UPDATE zalo_group SET name = ? WHERE id = ?", [`Nhóm ${key}`, group.id]);
      for (let i = 0; i < 2; i += 1) {
        await ingestGroupMessage(deps, bot.insertId, { zaloGroupId: zaloId, msgId: `${zaloId}-${i}`, cliMsgId: "", msgType: "webchat", senderUid: "u-x", senderName: "X",
          sentAtMs: NOW_MS - i * 60_000, content: `${KEYWORD} ${key} ${i}`, quote: null, mentions: null });
      }
      const [message] = await db.query<any[]>("SELECT id FROM message WHERE group_id = ? LIMIT 1", [group.id]);
      const [attachment] = await db.query<any>("INSERT INTO attachment (message_id, group_id, file_name, source_url, status) VALUES (?, ?, ?, 'x', 1)", [message[0].id, group.id, `${key}.pdf`]);
      fid[key] = attachment.insertId;
      await db.query("INSERT INTO attachment_text (attachment_id, method, text) VALUES (?, 'pdf', ?)", [attachment.insertId, `nội dung tệp ${key}`]);
      await db.query("INSERT INTO ticket (code, status, title, body, requester_uid, requester_name, source_thread_id) VALUES (?, 1, ?, 'nd', 'u-x', 'Khách', ?)", [`T-${key}`, `Ticket ${key}`, group.id]);
      await db.query("INSERT INTO audit_log (entity, entity_id, action, message, changed_fields, change_count, actor) VALUES ('group', ?, 'update', ?, '[]', 0, 'ai-do')", [group.id, `sửa nhóm ${key}`]);
      await db.query("INSERT INTO contact (zalo_uid, display_name, phone) VALUES (?, ?, ?)", [`u-${key}`, `Người ${key}`, "0901234567"]);
      await db.query("INSERT INTO group_member (group_id, zalo_uid) VALUES (?, ?)", [group.id, `u-${key}`]);
    }
    await updateGroupSettings(db, gid.mat, { isConfidential: true });
    // Cuộc riêng 2 người (thread_type 0)
    const [dm] = await db.query<any>("INSERT INTO zalo_group (thread_type, zalo_group_id, name, read_messages) VALUES (0, 'dm-1', 'Riêng A-B', 1)");
    gid.dm = dm.insertId;
    await db.query("INSERT INTO message (group_id, zalo_msg_id, kind, sender_uid, sender_name, sent_at, text) VALUES (?, 'dm-1-m', 0, 'u-a', 'A', ?, ?)", [gid.dm, new Date(NOW_MS), `${KEYWORD} riêng`]);

    people.admin = await addUser("quantri", UserRole.Admin, { allGroups: true });
    people.adminMat = { ...people.admin, canViewConfidential: true };
    people.managerScoped = await addUser("quanlykhoanh", UserRole.Manager, { groups: [gid.a, gid.mat] });
    people.managerMat = { ...people.managerScoped, canViewConfidential: true };
    people.staff = await addUser("nhanvien", UserRole.Staff, { groups: [gid.a] });
    people.staffAudit = await addUser("nhanvienlog", UserRole.Staff, { groups: [gid.a], audit: true });
  });
  after(async () => { await db?.end(); });

  const ctxOf = (who: string, maskPersonal = false) => makeCtx(people[who], { maskPersonal }, db);
  const query = (who: string, input: Record<string, unknown>, maskPersonal = false) => runTool(findTool("query_records")!, ctxOf(who, maskPersonal), input);
  const itemsOf = (result: ToolResult) => (result.structured as { items: Record<string, unknown>[] }).items;
  const idsOf = (result: ToolResult, column = "id") => itemsOf(result).map((item) => Number(item[column])).sort((a, b) => a - b);
  const sorted = (...ids: number[]) => [...ids].sort((a, b) => a - b);

  test("groups: quản trị không cờ thấy mọi nhóm trừ Mật; cờ Mật thêm nhóm Mật; Quản lý khoanh chỉ nhóm được gán", async () => {
    const list = (who: string) => query(who, { entity: "groups", fields: ["id"], filters: [{ field: "name", op: "contains", value: "Nhóm " }] });
    assert.deepEqual(idsOf(await list("admin")), sorted(gid.a, gid.b));
    assert.deepEqual(idsOf(await list("adminMat")), sorted(gid.a, gid.b, gid.mat));
    assert.deepEqual(idsOf(await list("managerScoped")), [gid.a], "được gán nhóm Mật nhưng chưa có cờ");
    assert.deepEqual(idsOf(await list("managerMat")), sorted(gid.a, gid.mat), "ngoài phạm vi (b) vẫn ẩn dù có cờ Mật");
    assert.deepEqual(idsOf(await list("staff")), [gid.a]);
  });

  test("messages: đếm theo nhóm chỉ gồm nhóm thấy được", async () => {
    const counts = async (who: string) => {
      const result = await query(who, { entity: "messages", filters: [{ field: "sent_at", op: "between", value: ["2026-10-09", "2026-10-11"] }], aggregate: { fn: "count", group_by: [{ field: "thread_id" }] } });
      assert.equal(result.isError, false, JSON.stringify(result.structured));
      return Object.fromEntries((result.structured as { groups: { thread_id: number; count: number }[] }).groups.map((row) => [row.thread_id, row.count]));
    };
    assert.deepEqual(await counts("staff"), { [gid.a]: 2 });
    assert.deepEqual(await counts("managerScoped"), { [gid.a]: 2 });
    assert.deepEqual(await counts("managerMat"), { [gid.a]: 2, [gid.mat]: 2 });
    const admin = await counts("admin");
    assert.equal(admin[gid.mat], undefined);
    assert.equal(admin[gid.b], 2);
  });

  test("files: liệt kê + get_file_text — ngoài phạm vi / Mật không cờ = not_found", async () => {
    const files = async (who: string) => idsOf(await query(who, { entity: "files", fields: ["id"] }));
    assert.deepEqual(await files("staff"), [fid.a]);
    assert.deepEqual(await files("admin"), sorted(fid.a, fid.b));
    assert.deepEqual(await files("adminMat"), sorted(fid.a, fid.b, fid.mat));
    const read = (who: string, attachmentId: number) => runTool(findTool("get_file_text")!, ctxOf(who), { attachment_id: attachmentId });
    assert.equal((await read("staff", fid.a)).isError, false);
    assert.equal((await read("staff", fid.b)).errorCode, "not_found");
    assert.equal((await read("admin", fid.mat)).errorCode, "not_found");
    assert.equal((await read("managerMat", fid.mat)).isError, false);
    assert.match((await read("managerMat", fid.mat)).structured && JSON.stringify((await read("managerMat", fid.mat)).structured), /nội dung tệp mat/);
  });

  test("search_messages: chỉ nhóm thấy được; gộp nhiều nhóm; id nhóm ngoài phạm vi không lấy được", async () => {
    const search = async (who: string, extra: Record<string, unknown> = {}) =>
      new Set(((await runTool(findTool("search_messages")!, ctxOf(who), { query: KEYWORD, ...extra })).structured as { hits: { thread_id: number }[] }).hits.map((hit) => hit.thread_id));
    assert.deepEqual([...await search("staff")], [gid.a]);
    assert.deepEqual([...await search("admin")].sort(), sorted(gid.a, gid.b).map(Number).sort());
    assert.ok((await search("managerMat")).has(gid.mat));
    assert.ok(!(await search("managerScoped")).has(gid.mat));
    assert.equal((await search("staff", { thread_ids: [gid.b, gid.mat] })).size, 0, "thread_ids ngoài phạm vi không mở rộng quyền");
  });

  test("cuộc riêng 2 người: người khoanh nhóm không thấy; quản trị ngữ cảnh «chỉ cuộc riêng của mình» (khóa MCP) không thấy cuộc người khác", async () => {
    const find = async (who: string, overrides = {}) => idsOf(await runTool(findTool("query_records")!, makeCtx(people[who], overrides, db),
      { entity: "conversations", fields: ["id"], filters: [{ field: "name", op: "contains", value: "Riêng A-B" }] }));
    assert.deepEqual(await find("staff"), []);
    assert.deepEqual(await find("admin"), [gid.dm], "luật web: quản trị «mọi nhóm» thấy cuộc riêng");
    assert.deepEqual(await find("admin", { ownDirectThreadsOnly: true, ownDirectUid: "u-khac" }), []);
    assert.equal((await runTool(findTool("get_thread_messages")!, makeCtx(people.admin, { ownDirectThreadsOnly: true, ownDirectUid: null }, db), { thread_id: gid.dm })).errorCode, "not_found");
  });

  test("contacts: Nhân viên không đọc được cột SĐT; có che dữ liệu cá nhân thì SĐT bị che; thành viên nhóm ngoài phạm vi không lộ", async () => {
    const seen = itemsOf(await query("staff", { entity: "contacts", fields: ["zalo_uid"], search: "Người" })).map((row) => row.zalo_uid);
    assert.deepEqual(seen, ["u-a"], "chỉ thành viên nhóm trong phạm vi");
    assert.equal((await query("staff", { entity: "contacts", fields: ["zalo_uid", "phone"] })).errorCode, "invalid_field");
    const raw = JSON.stringify(itemsOf(await query("admin", { entity: "contacts", fields: ["phone"], search: "Người" }, false)));
    const masked = JSON.stringify(itemsOf(await query("admin", { entity: "contacts", fields: ["phone"], search: "Người" }, true)));
    assert.match(raw, /0901234567/);
    assert.doesNotMatch(masked, /0901234567/);
  });

  test("tickets: lọc theo nhóm nguồn trong phạm vi + nhóm Mật theo cờ", async () => {
    const tickets = async (who: string) => (await query(who, { entity: "tickets", fields: ["code"] }).then(itemsOf)).map((row) => String(row.code)).sort();
    assert.deepEqual(await tickets("staff"), ["T-a"]);
    assert.deepEqual(await tickets("admin"), ["T-a", "T-b"]);
    assert.deepEqual(await tickets("adminMat"), ["T-a", "T-b", "T-mat"]);
  });

  test("audit_log: không có cờ / không quản trị → bị chặn; có cờ thì chỉ dòng của bản ghi trong phạm vi; quản trị không cờ Mật bị ẩn dòng nhóm Mật", async () => {
    const audit = (who: string) => query(who, { entity: "audit_log", fields: ["entity_id"], filters: [{ field: "entity", op: "eq", value: "group" }] });
    assert.equal((await audit("staff")).isError, true, "Nhân viên không cờ nhật ký");
    assert.deepEqual(idsOf(await audit("staffAudit"), "entity_id"), [gid.a]);
    assert.deepEqual(idsOf(await audit("admin"), "entity_id"), sorted(gid.a, gid.b));
    assert.deepEqual(idsOf(await audit("adminMat"), "entity_id"), sorted(gid.a, gid.b, gid.mat));
  });
});
