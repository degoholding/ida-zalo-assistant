import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskPriority, TaskRemindStage, TaskSource, TaskStatus } from "../constants.js";
import { describeTaskLine, dueDeadline, formatDue, isTaskOverdue, overdueLabel } from "./task-format.js";
import { otherParties } from "./task-notify.js";
import type { TaskRow } from "./task-repository.js";

const vn = (iso: string) => new Date(`${iso}+07:00`);

const task = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  id: 12, code: "V-0012", status: TaskStatus.Open, priority: TaskPriority.Normal, title: "Gửi báo giá đại lý XT",
  assignee: { contactId: 1, uid: "u-minh", name: "Minh" }, assigner: { contactId: 2, uid: "u-lan", name: "Lan" },
  source: TaskSource.Command, source_thread_id: 5, source_message_id: null, due_at: vn("2026-10-16T00:00:00"), due_has_time: false,
  remind_stage: TaskRemindStage.None, resolution: "", created_at: vn("2026-10-09T09:00:00"), ...overrides,
});

test("formatDue: thứ + ngày giờ Việt Nam, khác năm thì thêm năm, không hạn thì nói rõ", () => {
  const now = vn("2026-10-09T10:00:00");
  assert.equal(formatDue(vn("2026-10-16T00:00:00"), false, now), "T6 16/10");
  assert.equal(formatDue(vn("2026-10-16T17:00:00"), true, now), "17:00 T6 16/10");
  assert.equal(formatDue(vn("2027-01-04T08:05:00"), true, now), "08:05 T2 04/01/2027");
  assert.equal(formatDue(vn("2026-10-18T00:00:00"), false, now), "CN 18/10");
  assert.equal(formatDue(null, false, now), "chưa có hạn");
});

test("hạn chỉ có ngày = hết ngày đó (giờ VN); hạn có giờ = đúng giờ đó", () => {
  assert.equal(dueDeadline(task())?.toISOString(), vn("2026-10-17T00:00:00").toISOString());
  assert.equal(isTaskOverdue(task(), vn("2026-10-16T23:59:00")), false, "vẫn trong ngày hạn");
  assert.equal(isTaskOverdue(task(), vn("2026-10-17T00:00:00")), true);
  const timed = task({ due_at: vn("2026-10-16T17:00:00"), due_has_time: true });
  assert.equal(isTaskOverdue(timed, vn("2026-10-16T16:59:00")), false);
  assert.equal(isTaskOverdue(timed, vn("2026-10-16T17:00:00")), true);
});

test("chỉ việc ĐANG LÀM mới quá hạn; không có hạn thì không bao giờ quá hạn", () => {
  const late = vn("2026-10-20T09:00:00");
  for (const status of [TaskStatus.Proposed, TaskStatus.Done, TaskStatus.Cancelled]) assert.equal(isTaskOverdue(task({ status }), late), false);
  assert.equal(isTaskOverdue(task({ due_at: null }), late), false);
  assert.equal(overdueLabel(task({ due_at: null }), late), "");
});

test("overdueLabel: đếm theo ngày lịch VN, trong ngày đầu tiên chỉ nói «quá hạn»", () => {
  const timed = task({ due_at: vn("2026-10-16T17:00:00"), due_has_time: true });
  assert.equal(overdueLabel(timed, vn("2026-10-16T18:00:00")), "quá hạn");
  assert.equal(overdueLabel(timed, vn("2026-10-17T08:00:00")), "quá hạn 1 ngày");
  assert.equal(overdueLabel(task(), vn("2026-10-19T09:00:00")), "quá hạn 2 ngày");
});

test("describeTaskLine: mã ngắn, người phụ trách, hạn, nhãn quá hạn; thiếu người thì nói rõ", () => {
  const now = vn("2026-10-19T09:00:00");
  assert.equal(describeTaskLine(task(), now), "V-12 Gửi báo giá đại lý XT — Minh — hạn T6 16/10 (quá hạn 2 ngày)");
  assert.match(describeTaskLine(task({ assignee: null, status: TaskStatus.Proposed }), now), /^V-12 \[chờ xác nhận\] .* — chưa có người phụ trách —/);
});

test("otherParties: báo người phụ trách + người giao trừ người đang thao tác, không báo trùng, bỏ người không có mã Zalo", () => {
  const names = (list: { name: string }[]) => list.map((party) => party.name);
  assert.deepEqual(names(otherParties(task(), { uid: "u-minh", contactId: 1 })), ["Lan"]);
  assert.deepEqual(names(otherParties(task(), { uid: null, contactId: null })), ["Minh", "Lan"], "làm trên web: báo cả hai");
  // Tự giao cho mình → chỉ một người
  assert.deepEqual(names(otherParties(task({ assigner: { contactId: 1, uid: "u-minh", name: "Minh" } }), { uid: null, contactId: null })), ["Minh"]);
  assert.deepEqual(names(otherParties(task({ assigner: { contactId: null, uid: null, name: "Quản trị web" } }), { uid: "u-x", contactId: 9 })), ["Minh"]);
  assert.deepEqual(names(otherParties(task({ assignee: null }), { uid: "u-lan", contactId: 2 })), []);
});
