import assert from "node:assert/strict";
import { test } from "node:test";
import { decideTaskRelationship, decideTicketRelationship, taskActorOf, ticketActorOf } from "./contact-relationship-rules.js";
import { buildContactActor } from "./contact-actor.js";
import { fakeDb } from "../data-access-test-support.js";

// Ca chính của luật quan hệ (hàm thuần). Đối chiếu đầy đủ với luật cũ trên MySQL: test/assistant-contact-actor.integration.test.ts (test vàng).

const me = { uid: "u-me", contactId: 5, groupId: null as number | null };
const mine = { contactId: 5, uid: "u-me", name: "Tôi" };
const other = { contactId: 6, uid: "u-other", name: "Khác" };

test("việc: người giao quản lý được; người phụ trách chỉ làm (xong / ghi chú), không quản lý; sếp làm mọi việc; người lạ không thấy", () => {
  const asAssigner = decideTaskRelationship(me, false, { assigner: mine, assignee: other, sourceThreadId: 1 });
  assert.deepEqual([asAssigner.canView, asAssigner.canWork, asAssigner.canManage], [true, true, true]);
  const asAssignee = decideTaskRelationship(me, false, { assigner: other, assignee: mine, sourceThreadId: 1 });
  assert.deepEqual([asAssignee.canView, asAssignee.canWork, asAssignee.canManage], [true, true, false]);
  const boss = decideTaskRelationship(me, true, { assigner: other, assignee: other, sourceThreadId: 1 });
  assert.deepEqual([boss.canView, boss.canWork, boss.canManage], [true, true, true]);
  const stranger = decideTaskRelationship(me, false, { assigner: other, assignee: other, sourceThreadId: 1 });
  assert.deepEqual([stranger.canView, stranger.canWork, stranger.canManage], [false, false, false]);
});

test("việc: hỏi trong nhóm chỉ thấy việc của nhóm đó — kể cả sếp; người giao ở nhóm khác không thấy", () => {
  const inGroup = { ...me, groupId: 3 };
  assert.equal(decideTaskRelationship(inGroup, true, { assigner: other, assignee: null, sourceThreadId: 3 }).canView, true);
  assert.equal(decideTaskRelationship(inGroup, true, { assigner: other, assignee: null, sourceThreadId: 4 }).canView, false);
  assert.equal(decideTaskRelationship(inGroup, false, { assigner: mine, assignee: null, sourceThreadId: 4 }).canManage, false);
});

test("ticket: người lạ không thấy; nhận chỉ người xử lý; xong người xử lý hoặc người báo; người báo tự đóng đánh dấu asRequester", () => {
  const ticket = { requesterUid: "u-req", sourceThreadId: 1, visibleToOverseer: true };
  const decide = (facts: { handler: boolean; overseer: boolean }, t = ticket, action: Parameters<typeof decideTicketRelationship>[3] = "status", who = me) =>
    decideTicketRelationship(who, facts, t, action);
  assert.deepEqual(decide({ handler: false, overseer: false }), { ok: false, reason: "not_found" });
  assert.deepEqual(decide({ handler: false, overseer: true }, ticket, "accept"), { ok: false, reason: "handler_only" });
  assert.deepEqual(decide({ handler: false, overseer: true }, ticket, "done"), { ok: false, reason: "handler_or_requester" });
  assert.deepEqual(decide({ handler: true, overseer: true }, ticket, "done"), { ok: true, isRequester: false, isHandler: true, asRequester: false });
  const requester = { requesterUid: "u-me", sourceThreadId: 1, visibleToOverseer: false };
  assert.deepEqual(decide({ handler: false, overseer: false }, requester, "done"), { ok: true, isRequester: true, isHandler: false, asRequester: true });
  assert.deepEqual(decide({ handler: true, overseer: true }, requester, "cancel"), { ok: true, isRequester: true, isHandler: true, asRequester: false });
});

test("ticket: trong nhóm chỉ ticket của nhóm đó (cả người báo); người xem ticket của người khác còn qua luật nhóm / Mật", () => {
  const facts = { handler: true, overseer: true };
  assert.equal(decideTicketRelationship({ uid: "u-me", groupId: 2 }, facts, { requesterUid: "u-me", sourceThreadId: 3, visibleToOverseer: true }, "status").ok, false);
  assert.equal(decideTicketRelationship({ uid: "u-me", groupId: 3 }, facts, { requesterUid: "u-me", sourceThreadId: 3, visibleToOverseer: true }, "status").ok, true);
  assert.equal(decideTicketRelationship(me, facts, { requesterUid: "u-x", sourceThreadId: 3, visibleToOverseer: false }, "status").ok, false, "nhóm Mật / ngoài phạm vi");
  assert.equal(decideTicketRelationship(me, { handler: false, overseer: false }, { requesterUid: "u-me", sourceThreadId: 3, visibleToOverseer: false }, "status").ok, true, "người báo luôn thấy của mình");
});

test("nhãn người ghi: via zalo + contactId + tên, như lệnh gõ hôm nay", () => {
  const actor = buildContactActor(fakeDb().db, { contact: { id: 5, uid: "u-me", name: "Lan", role: 0, kind: 2 }, origin: "derived_role" });
  assert.deepEqual(taskActorOf(actor), { contactId: 5, uid: "u-me", name: "Lan", via: "zalo" });
  assert.deepEqual(ticketActorOf(actor), { name: "Lan", contactId: 5, via: "zalo" });
});
