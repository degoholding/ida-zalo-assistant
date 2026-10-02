import assert from "node:assert/strict";
import { test } from "node:test";
import { GroupEventType, type GroupEvent } from "zca-js";
import { describeGroupEvent, namesToLookup } from "./group-event-text.js";

const NAMES: Record<string, string> = { "1": "Duy", "2": "Hân", "3": "Bảo Huỳnh" };
const lookup = (uid: string) => NAMES[uid] ?? "Một thành viên";
const NOW = Date.parse("2026-10-02T07:00:00.000Z");

function makeEvent(type: GroupEventType, data: Record<string, unknown>): GroupEvent {
  return { type, data: { groupId: "g1", time: "1790391868086", ...data }, act: "", threadId: "1866945095934480500", isSelf: false } as unknown as GroupEvent;
}

test("someone added by another member reads as an add, not a self join", () => {
  const summary = describeGroupEvent(makeEvent(GroupEventType.JOIN, { sourceId: "1", updateMembers: [{ id: "3", dName: "Bảo Huỳnh" }] }), lookup, "K52", NOW);
  assert.equal(summary?.text, "Duy đã thêm Bảo Huỳnh vào nhóm");
  assert.equal(summary?.actorUid, "1");
  assert.equal(summary?.sentAtMs, 1790391868086);
});

test("joining by link (actor is the member) reads as a self join", () => {
  assert.equal(describeGroupEvent(makeEvent(GroupEventType.JOIN, { sourceId: "2", updateMembers: [{ id: "2", dName: "Hân" }] }), lookup, "", NOW)?.text, "Hân đã tham gia nhóm");
  assert.equal(describeGroupEvent(makeEvent(GroupEventType.JOIN, { updateMembers: [{ id: "2", dName: "Hân" }] }), lookup, "", NOW)?.text, "Hân đã tham gia nhóm");
});

test("names missing from the event fall back to the store, then a neutral label", () => {
  const summary = describeGroupEvent(makeEvent(GroupEventType.REMOVE_MEMBER, { sourceId: "1", updateMembers: [{ id: "2", dName: "" }, { id: "999" }] }), lookup, "", NOW);
  assert.equal(summary?.text, "Duy đã xóa Hân và Một thành viên khỏi nhóm");
});

test("long member lists are shortened instead of flooding the chat", () => {
  const members = ["a", "b", "c", "d", "e"].map((id) => ({ id, dName: id.toUpperCase() }));
  assert.equal(describeGroupEvent(makeEvent(GroupEventType.JOIN, { sourceId: "1", updateMembers: members }), lookup, "", NOW)?.text, "Duy đã thêm A, B và 3 người khác vào nhóm");
  const three = members.slice(0, 3);
  assert.equal(describeGroupEvent(makeEvent(GroupEventType.LEAVE, { updateMembers: three }), lookup, "", NOW)?.text, "A, B và C đã rời khỏi nhóm");
});

test("member events without members are dropped rather than producing a half sentence", () => {
  for (const type of [GroupEventType.JOIN, GroupEventType.LEAVE, GroupEventType.REMOVE_MEMBER, GroupEventType.ADD_ADMIN]) {
    assert.equal(describeGroupEvent(makeEvent(type, { sourceId: "1", updateMembers: [] }), lookup, "", NOW), null);
    assert.equal(describeGroupEvent(makeEvent(type, { sourceId: "1" }), lookup, "", NOW), null);
  }
});

test("UPDATE only counts as a rename when the name really changed", () => {
  assert.equal(describeGroupEvent(makeEvent(GroupEventType.UPDATE, { sourceId: "1", groupName: "K52 mới" }), lookup, "K52", NOW)?.text, "Duy đã đổi tên nhóm thành «K52 mới»");
  assert.equal(describeGroupEvent(makeEvent(GroupEventType.UPDATE, { sourceId: "1", groupName: "K52" }), lookup, "K52", NOW), null);
  assert.equal(describeGroupEvent(makeEvent(GroupEventType.UPDATE, { sourceId: "1", groupName: "" }), lookup, "K52", NOW), null);
});

test("events the chat does not show are ignored", () => {
  for (const type of [GroupEventType.NEW_PIN_TOPIC, GroupEventType.UPDATE_SETTING, GroupEventType.REMIND_TOPIC, GroupEventType.UNKNOWN, GroupEventType.JOIN_REQUEST]) {
    assert.equal(describeGroupEvent(makeEvent(type, { sourceId: "1", updateMembers: [{ id: "2" }] }), lookup, "", NOW), null);
  }
});

test("the same event yields the same id whichever bot receives it, different events differ", () => {
  const event = makeEvent(GroupEventType.JOIN, { sourceId: "1", updateMembers: [{ id: "3" }, { id: "2" }] });
  const reordered = makeEvent(GroupEventType.JOIN, { sourceId: "1", updateMembers: [{ id: "2" }, { id: "3" }] });
  const first = describeGroupEvent(event, lookup, "", NOW);
  assert.equal(first?.msgId, describeGroupEvent(reordered, lookup, "", NOW)?.msgId);
  assert.ok(first && first.msgId.length <= 40, "vừa cột zalo_msg_id VARCHAR(40)");
  assert.notEqual(first?.msgId, describeGroupEvent(makeEvent(GroupEventType.LEAVE, { updateMembers: [{ id: "2" }, { id: "3" }] }), lookup, "", NOW)?.msgId);
});

test("a missing or broken event time falls back to now", () => {
  assert.equal(describeGroupEvent(makeEvent(GroupEventType.UPDATE_AVATAR, { sourceId: "1", time: "" }), lookup, "", NOW)?.sentAtMs, NOW);
  assert.equal(describeGroupEvent(makeEvent(GroupEventType.UPDATE_AVATAR, { sourceId: "1", time: "abc" }), lookup, "", NOW)?.sentAtMs, NOW);
});

test("lookup list holds the actor and only members that came without a name", () => {
  assert.deepEqual(namesToLookup(makeEvent(GroupEventType.JOIN, { sourceId: "1", updateMembers: [{ id: "2", dName: "Hân" }, { id: "3" }] })).sort(), ["1", "3"]);
  assert.deepEqual(namesToLookup(makeEvent(GroupEventType.UPDATE_AVATAR, {})), []);
});
