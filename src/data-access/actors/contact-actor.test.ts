import assert from "node:assert/strict";
import { test } from "node:test";
import { ContactKind, ContactRole } from "../../constants.js";
import { fakeDb } from "../data-access-test-support.js";
import { actorFactMemo, buildContactActor, type AskerOrigin } from "./contact-actor.js";

// Chủ thể liên hệ Zalo + sự thật lười (không DB thật): «DB» giả trả dòng theo câu SQL, đếm số lần hỏi.

interface World { handler?: boolean; recipient?: boolean }

function actorOf(role: number, origin: AskerOrigin, world: World = {}) {
  const sim = fakeDb((sql) => {
    if (/FROM ticket_handler/.test(sql)) return world.handler ? [{ 1: 1 }] : [];
    if (/FROM recipient r/.test(sql)) return world.recipient ? [{ 1: 1 }] : [];
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
