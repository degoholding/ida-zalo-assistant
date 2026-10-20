import assert from "node:assert/strict";
import { test } from "node:test";
import { ContactKind, ContactRole, UserRole } from "../../constants.js";
import { fakeDb } from "../data-access-test-support.js";
import { actorFactMemo, buildContactActor, type AskerOrigin } from "./contact-actor.js";

// Chủ thể liên hệ Zalo + sự thật lười (không DB thật): «DB» giả trả dòng theo câu SQL, đếm số lần hỏi.

interface World { handler?: boolean; recipient?: boolean; webRoles?: number[]; messages?: { id: number; text: string; sender: string }[] }

function actorOf(role: number, origin: AskerOrigin, world: World = {}) {
  const sim = fakeDb((sql, params) => {
    if (/FROM ticket_handler/.test(sql)) return world.handler ? [{ 1: 1 }] : [];
    if (/FROM recipient r/.test(sql)) return world.recipient ? [{ 1: 1 }] : [];
    if (/FROM app_user/.test(sql)) return (world.webRoles ?? []).map((role) => ({ role }));
    if (/FROM message WHERE id = \?/.test(sql)) return world.messages?.filter((message) => message.id === params[0]).map((message) => ({ text: message.text })) ?? [];
    if (/FROM message WHERE group_id/.test(sql)) return (world.messages ?? []).filter((message) => message.sender !== "u-31").map((message) => ({ text: message.text }));
    return [];
  });
  const actor = buildContactActor(sim.db, {
    contact: { id: 31, uid: "u-31", name: "Lan", role, kind: ContactKind.Staff }, origin, threadId: 9, messageId: 99, botAccountId: 2, groupId: null,
  });
  return { actor, queries: sim.queries };
}

test("buildContactActor giữ danh tính + cuộc / tin của lượt; mặc định null khi không có", () => {
  const { actor } = actorOf(ContactRole.None, "derived_recipient");
  assert.deepEqual({ contactId: actor.contactId, uid: actor.uid, name: actor.name, threadId: actor.threadId, messageId: actor.messageId, botAccountId: actor.botAccountId, groupId: actor.groupId },
    { contactId: 31, uid: "u-31", name: "Lan", threadId: 9, messageId: 99, botAccountId: 2, groupId: null });
  const bare = buildContactActor(fakeDb().db, { contact: { id: 1, uid: "u", name: "x", role: 0, kind: 0 }, origin: "derived_role" });
  assert.deepEqual([bare.threadId, bare.messageId, bare.botAccountId, bare.groupId], [null, null, null, null]);
});

test("facts lười: không hỏi DB khi chưa gọi; mỗi sự thật hỏi đúng MỘT lần", async () => {
  const { actor, queries } = actorOf(ContactRole.None, "derived_recipient", { recipient: true });
  assert.equal(queries.length, 0);
  assert.equal(await actor.facts.isTaskOverseer(), true);
  assert.equal(await actor.facts.isTaskOverseer(), true);
  assert.equal(queries.length, 1);
  assert.equal(await actor.facts.isTicketHandler(), false);
  await actor.facts.isTicketHandler();
  await actor.facts.isTicketOverseer();
  assert.equal(queries.length, 2, "isTicketOverseer dùng lại kết quả handler đã nhớ");
});

test("isTaskOverseer: vai trò Danh bạ → sếp không cần hỏi DB; không vai trò → theo người nhận đang bật; tài khoản tắt → không", async () => {
  const withRole = actorOf(ContactRole.Manager, "derived_role");
  assert.equal(await withRole.actor.facts.isTaskOverseer(), true);
  assert.equal(withRole.queries.length, 0);
  assert.equal(await actorOf(ContactRole.None, "derived_recipient", { recipient: false }).actor.facts.isTaskOverseer(), false);
  const disabled = actorOf(ContactRole.Manager, "disabled_account", { recipient: true });
  assert.equal(await disabled.actor.facts.isTaskOverseer(), false);
  assert.equal(disabled.queries.length, 0);
});

test("isTicketOverseer: người xử lý luôn; vai trò > 0 trừ tài khoản tắt; không vai trò và không là người xử lý → không", async () => {
  assert.equal(await actorOf(ContactRole.None, "derived_recipient", { handler: true }).actor.facts.isTicketOverseer(), true);
  assert.equal(await actorOf(ContactRole.DepartmentHead, "derived_role").actor.facts.isTicketOverseer(), true);
  assert.equal(await actorOf(ContactRole.Manager, "disabled_account").actor.facts.isTicketOverseer(), false);
  assert.equal(await actorOf(ContactRole.Manager, "disabled_account", { handler: true }).actor.facts.isTicketOverseer(), true, "người xử lý do quản trị chỉ định thì giữ");
  assert.equal(await actorOf(ContactRole.None, "derived_recipient").actor.facts.isTicketOverseer(), false);
});

test("facts không nhớ lỗi: lần sau thử lại", async () => {
  let calls = 0;
  const db = { query: async () => { calls++; if (calls === 1) throw new Error("mất kết nối"); return [[{ 1: 1 }], []]; } } as never;
  const actor = buildContactActor(db, { contact: { id: 1, uid: "u", name: "x", role: 0, kind: 0 }, origin: "derived_recipient" });
  await assert.rejects(actor.facts.isTicketHandler());
  assert.equal(await actor.facts.isTicketHandler(), true);
});

test("actorFactMemo: nhớ theo contactActor (các bản sao ctx dùng chung), khác khóa thì khác; không có chủ thể → không nhớ; lỗi không được nhớ", async () => {
  const { actor } = actorOf(ContactRole.None, "derived_recipient");
  let loads = 0;
  const load = async () => ++loads;
  const ctx = { contactActor: actor };
  assert.equal(await actorFactMemo(ctx, "alert-recipient", load), 1);
  assert.equal(await actorFactMemo({ ...ctx }, "alert-recipient", load), 1, "bản sao ctx vẫn dùng chung");
  assert.equal(await actorFactMemo(ctx, "send-requester", load), 2);
  assert.equal(await actorFactMemo({}, "alert-recipient", load), 3);
  assert.equal(await actorFactMemo({}, "alert-recipient", load), 4);
  let attempts = 0;
  const flaky = async () => { if (++attempts === 1) throw new Error("lỗi"); return "ok"; };
  await assert.rejects(actorFactMemo(ctx, "flaky", flaky));
  assert.equal(await actorFactMemo(ctx, "flaky", flaky), "ok");
  const other = actorOf(ContactRole.None, "derived_recipient").actor;
  assert.equal(await actorFactMemo({ contactActor: other }, "alert-recipient", load), 5, "chủ thể (lượt) khác không dùng chung bộ nhớ");
});

test("D-B webRoleAllowsOversight: tài khoản web Nhân viên → không quyền «sếp» dù vai trò Danh bạ Quản lý; Quản trị / Quản lý → có; không tài khoản web → theo Danh bạ", async () => {
  const staff = actorOf(ContactRole.Manager, "web_user", { webRoles: [UserRole.Staff] });
  assert.equal(await staff.actor.facts.webRoleAllowsOversight(), false);
  assert.equal(await staff.actor.facts.isTaskOverseer(), false);
  assert.equal(await staff.actor.facts.isTicketOverseer(), false);
  for (const role of [UserRole.Admin, UserRole.Manager]) {
    const boss = actorOf(ContactRole.Manager, "web_user", { webRoles: [role] });
    assert.equal(await boss.actor.facts.isTaskOverseer(), true);
    assert.equal(await boss.actor.facts.isTicketOverseer(), true);
  }
  // Nhiều tài khoản cùng liên hệ: hẹp nhất; không dòng nào đang bật (tắt giữa chừng) → không quyền
  assert.equal(await actorOf(ContactRole.Manager, "web_user", { webRoles: [UserRole.Manager, UserRole.Staff] }).actor.facts.isTaskOverseer(), false);
  assert.equal(await actorOf(ContactRole.Manager, "web_user", { webRoles: [] }).actor.facts.isTaskOverseer(), false);
  // Không tài khoản web / nguồn khác: không hỏi app_user, giữ luật Danh bạ
  const derived = actorOf(ContactRole.Manager, "derived_role");
  assert.equal(await derived.actor.facts.isTaskOverseer(), true);
  assert.equal(derived.queries.filter((query) => /FROM app_user/.test(query.sql)).length, 0);
  // Người nhận cảnh báo + web Nhân viên: cũng mất quyền «sếp» của việc; người xử lý ticket (quản trị chỉ định) giữ
  assert.equal(await actorOf(ContactRole.None, "web_user", { webRoles: [UserRole.Staff], recipient: true }).actor.facts.isTaskOverseer(), false);
  assert.equal(await actorOf(ContactRole.None, "web_user", { webRoles: [UserRole.Staff], handler: true }).actor.facts.isTicketOverseer(), true);
});

test("D-A ownTurnTexts: chữ của chính người hỏi đọc từ tin hỏi + câu bot liền trước (cuộc riêng); trong nhóm không có câu bot; ghi đè được; nhớ một lần", async () => {
  const world: World = { messages: [{ id: 99, text: "hủy V-12 đi", sender: "u-31" }, { id: 50, text: "VIỆC CỦA ANH/CHỊ\nV-12 gửi báo giá", sender: "u-bot" }] };
  const dm = actorOf(ContactRole.None, "derived_recipient", world);
  assert.deepEqual(await dm.actor.facts.ownTurnTexts(), { asker: "hủy V-12 đi", previousBotReply: "VIỆC CỦA ANH/CHỊ\nV-12 gửi báo giá" });
  await dm.actor.facts.ownTurnTexts();
  assert.equal(dm.queries.length, 2, "mỗi truy vấn đúng một lần");
  const db = fakeDb((sql) => (/FROM message/.test(sql) ? [{ text: "x" }] : [])).db;
  const group = buildContactActor(db, { contact: { id: 31, uid: "u-31", name: "Lan", role: 0, kind: 2 }, origin: "derived_role", threadId: 9, messageId: 99, groupId: 9 });
  assert.equal((await group.facts.ownTurnTexts()).previousBotReply, "", "hỏi trong nhóm: không tính câu bot");
  const forced = buildContactActor(fakeDb().db, { contact: { id: 31, uid: "u-31", name: "Lan", role: 0, kind: 2 }, origin: "derived_role", askerText: "V-3", previousBotReply: "" });
  assert.deepEqual(await forced.facts.ownTurnTexts(), { asker: "V-3", previousBotReply: "" });
  const none = buildContactActor(fakeDb().db, { contact: { id: 31, uid: "u-31", name: "Lan", role: 0, kind: 2 }, origin: "derived_role" });
  assert.deepEqual(await none.facts.ownTurnTexts(), { asker: "", previousBotReply: "" }, "không tin thật (mô phỏng web): rỗng");
});
