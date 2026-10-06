import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_ACTIONS_PER_TURN,
  formatVnTime,
  parseNoteInput,
  parsePollInput,
  parseReminderInput,
  parseVnTime,
  runGroupAction,
  type GroupActions,
} from "./group-action-tools.js";

const NOW = new Date("2026-10-06T02:00:00Z"); // 09:00 giờ Việt Nam

function fakeActions() {
  const calls: { kind: string; input: unknown }[] = [];
  const actions: GroupActions = {
    createReminder: async (input) => { calls.push({ kind: "reminder", input }); return { id: "r1" }; },
    createPinnedNote: async (input) => { calls.push({ kind: "note", input }); return { id: "n1" }; },
    createPoll: async (input) => { calls.push({ kind: "poll", input }); return { id: "p1" }; },
    listNotes: async () => [{ id: "n9", title: "Họp 8h sáng mai", createdAt: Date.parse("2026-10-06T02:55:00Z") }],
    unpinNote: async (id) => { calls.push({ kind: "unpin", input: id }); },
    listReminders: async () => [{ id: "r9", title: "Họp nhóm", startTime: Date.parse("2026-10-07T01:00:00Z"), repeat: 0 }],
    cancelReminder: async (id) => { calls.push({ kind: "cancel", input: id }); },
  };
  return { actions, calls };
}

test("times without a zone are read as Vietnam time; with a zone they are kept", () => {
  assert.equal(parseVnTime("2026-10-07T08:00:00"), Date.parse("2026-10-07T01:00:00Z"));
  assert.equal(parseVnTime("2026-10-07T08:00:00+07:00"), Date.parse("2026-10-07T01:00:00Z"));
  assert.equal(parseVnTime("2026-10-07T01:00:00Z"), Date.parse("2026-10-07T01:00:00Z"));
  for (const bad of ["", "mai 8h", null, 42]) assert.equal(parseVnTime(bad), null);
  assert.equal(formatVnTime(Date.parse("2026-10-07T01:00:00Z")), "08:00 07/10/2026");
});

test("reminders need a title and a future time within a year", () => {
  const ok = parseReminderInput({ title: " Nộp báo cáo ", start_time: "2026-10-07T08:00:00+07:00", repeat: "weekly" }, NOW);
  assert.deepEqual(ok, { ok: true, value: { title: "Nộp báo cáo", startTime: Date.parse("2026-10-07T01:00:00Z"), repeat: 2 } });
  assert.match((parseReminderInput({ start_time: "2026-10-07T08:00:00" }, NOW) as { error: string }).error, /Thiếu nội dung/);
  assert.match((parseReminderInput({ title: "x", start_time: "mai" }, NOW) as { error: string }).error, /Thiếu hoặc sai giờ/);
  assert.match((parseReminderInput({ title: "x", start_time: "2026-10-05T08:00:00" }, NOW) as { error: string }).error, /đã qua/);
  assert.match((parseReminderInput({ title: "x", start_time: "2028-01-01T08:00:00" }, NOW) as { error: string }).error, /xa quá/);
  // Lặp lạ → không lặp, không làm hỏng việc tạo
  assert.equal((parseReminderInput({ title: "x", start_time: "2026-10-07T08:00:00", repeat: "yearly" }, NOW) as { value: { repeat: number } }).value.repeat, 0);
});

test("polls need 2 to 10 distinct options; notes need content", () => {
  assert.deepEqual(parsePollInput({ question: "Họp ngày nào?", options: ["Thứ 5", "Thứ 6", "Thứ 5", " "] }),
    { ok: true, value: { question: "Họp ngày nào?", options: ["Thứ 5", "Thứ 6"], allowMultiChoices: false } });
  assert.equal(parsePollInput({ question: "Q", options: ["A"] }).ok, false);
  assert.equal(parsePollInput({ question: "Q", options: Array.from({ length: 11 }, (_, i) => `O${i}`) }).ok, false);
  assert.equal(parsePollInput({ question: " ", options: ["A", "B"] }).ok, false);
  assert.equal(parseNoteInput({ content: "  " }).ok, false);
  assert.deepEqual(parseNoteInput({ content: "Báo cáo tháng 8: 40.555.800 VNĐ" }), { ok: true, value: { title: "Báo cáo tháng 8: 40.555.800 VNĐ" } });
});

test("actions run against the asked group and report what was created", async () => {
  const { actions, calls } = fakeActions();
  const counter = { done: 0 };
  const reminder = await runGroupAction(actions, counter, "create_reminder", { title: "Giao ban", start_time: "2026-10-12T09:00:00", repeat: "weekly" }, NOW);
  assert.deepEqual(reminder, { created: "nhắc hẹn", id: "r1", title: "Giao ban", time_vn: "09:00 12/10/2026", repeat: "hằng tuần" });
  await runGroupAction(actions, counter, "create_pinned_note", { content: "Ghim cái này" }, NOW);
  await runGroupAction(actions, counter, "create_poll", { question: "Q", options: ["A", "B"], allow_multiple: true }, NOW);
  assert.deepEqual(calls.map((call) => call.kind), ["reminder", "note", "poll"]);
  assert.equal(counter.done, 3);
});

test("bad input is reported without calling Zalo, and a turn is capped at three actions", async () => {
  const { actions, calls } = fakeActions();
  const counter = { done: 0 };
  const bad = await runGroupAction(actions, counter, "create_reminder", { title: "x", start_time: "hôm qua" }, NOW);
  assert.match(String(bad.error), /sai giờ/);
  assert.equal(calls.length, 0);
  for (let i = 0; i < MAX_ACTIONS_PER_TURN; i += 1) await runGroupAction(actions, counter, "create_pinned_note", { content: `n${i}` }, NOW);
  const capped = await runGroupAction(actions, counter, "create_pinned_note", { content: "thêm" }, NOW);
  assert.match(String(capped.error), /tối đa 3 việc/);
  assert.equal(calls.length, MAX_ACTIONS_PER_TURN);
});

test("unpinning and cancelling only accept ids that exist in the asked group", async () => {
  const { actions, calls } = fakeActions();
  const counter = { done: 0 };
  const notes = await runGroupAction(actions, counter, "list_pinned_notes", {}, NOW);
  assert.deepEqual(notes, { notes: [{ id: "n9", content: "Họp 8h sáng mai", created: "09:55 06/10/2026" }] });
  const reminders = await runGroupAction(actions, counter, "list_reminders", {}, NOW);
  assert.deepEqual(reminders, { reminders: [{ id: "r9", title: "Họp nhóm", time_vn: "08:00 07/10/2026", repeat: "không lặp" }] });
  // id bịa / của nhóm khác: từ chối, không gọi Zalo
  for (const [tool, key] of [["unpin_note", "note_id"], ["cancel_reminder", "reminder_id"]] as const) {
    assert.match(String((await runGroupAction(actions, counter, tool, { [key]: "khong-co" }, NOW)).error), /Không có mục này/);
    assert.match(String((await runGroupAction(actions, counter, tool, {}, NOW)).error), /Thiếu id/);
  }
  assert.equal(calls.length, 0);
  assert.equal((await runGroupAction(actions, counter, "unpin_note", { note_id: "n9" }, NOW)).done, "đã gửi lệnh bỏ ghim");
  assert.deepEqual(await runGroupAction(actions, counter, "cancel_reminder", { reminder_id: "r9" }, NOW), { done: "đã hủy nhắc hẹn", id: "r9" });
  assert.deepEqual(calls, [{ kind: "unpin", input: "n9" }, { kind: "cancel", input: "r9" }]);
  assert.equal(counter.done, 2);
});

test("outside a group there are no actions to run", async () => {
  const result = await runGroupAction(undefined, { done: 0 }, "create_reminder", { title: "x", start_time: "2026-10-07T08:00:00" }, NOW);
  assert.match(String(result.error), /chỉ làm được khi được gọi trong nhóm/);
});
