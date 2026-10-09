import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_HOLIDAYS, DEFAULT_QUIET_HOURS, DEFAULT_WORK_DAYS, DEFAULT_WORK_HOURS } from "../config.js";
import { TaskPriority, TaskRemindStage, TaskSource, TaskStatus } from "../constants.js";
import { buildWorkCalendar } from "../schedule/work-calendar.js";
import { composeAssigneeReminder, composeOverdueReport, nextReminderStage, reminderStageTimes } from "./task-reminder-plan.js";
import type { TaskRow } from "./task-repository.js";

// Lịch IDA mặc định: T2–T7, 08:30–12:00 + 13:30–17:30, nghỉ 01/01, 30/04, 01/05, 02/09
const calendar = buildWorkCalendar({ workHours: DEFAULT_WORK_HOURS, workDays: DEFAULT_WORK_DAYS, quietHours: DEFAULT_QUIET_HOURS, holidays: DEFAULT_HOLIDAYS });
const vn = (iso: string) => new Date(`${iso}+07:00`);
const iso = (at: Date | null) => at?.toISOString() ?? null;

test("3 mốc của hạn chỉ có ngày (T6 16/10): T5 08:30 · T6 08:30 · T7 08:30", () => {
  const times = reminderStageTimes(vn("2026-10-16T00:00:00"), false, calendar);
  assert.equal(iso(times.dayBefore), iso(vn("2026-10-15T08:30:00")));
  assert.equal(iso(times.due), iso(vn("2026-10-16T08:30:00")));
  assert.equal(iso(times.overdue), iso(vn("2026-10-17T08:30:00")));
});

test("hạn có giờ (17:00 T6): quá hạn = sau hạn 1 giờ LÀM VIỆC — 30 phút còn lại T6, 30 phút đầu T7", () => {
  const times = reminderStageTimes(vn("2026-10-16T17:00:00"), true, calendar);
  assert.equal(iso(times.due), iso(vn("2026-10-16T08:30:00")));
  assert.equal(iso(times.overdue), iso(vn("2026-10-17T09:00:00")));
});

test("trước hạn = ngày LÀM VIỆC liền trước: hạn T2 → T7; hạn sau ngày lễ 02/09 → nhảy qua ngày lễ", () => {
  assert.equal(iso(reminderStageTimes(vn("2026-10-12T00:00:00"), false, calendar).dayBefore), iso(vn("2026-10-10T08:30:00")));
  assert.equal(iso(reminderStageTimes(vn("2027-09-03T00:00:00"), false, calendar).dayBefore), iso(vn("2027-09-01T08:30:00")));
  // Hạn đúng ngày lễ / Chủ nhật: «tới hạn hôm nay» sẽ rơi SAU hạn → bỏ mốc đó, để mốc quá hạn nói đúng
  assert.equal(reminderStageTimes(vn("2027-09-02T00:00:00"), false, calendar).due, null);
  assert.equal(reminderStageTimes(vn("2026-10-11T10:00:00"), true, calendar).due, null);
  assert.equal(reminderStageTimes(vn("2026-10-16T08:00:00"), true, calendar).due, null, "hạn 08:00 trước giờ vào làm 08:30");
});

const input = (overrides: Partial<Parameters<typeof nextReminderStage>[0]> = {}) => ({
  due_at: vn("2026-10-16T17:00:00"), due_has_time: true, remind_stage: TaskRemindStage.None, baseline: vn("2026-10-09T10:00:00"), ...overrides,
});

test("nextReminderStage: đúng mốc theo giờ, mỗi mốc một lần", () => {
  assert.equal(nextReminderStage(input(), calendar, vn("2026-10-15T08:00:00")), null, "chưa tới mốc 1");
  assert.equal(nextReminderStage(input(), calendar, vn("2026-10-15T08:30:00")), TaskRemindStage.DayBefore);
  assert.equal(nextReminderStage(input({ remind_stage: TaskRemindStage.DayBefore }), calendar, vn("2026-10-15T15:00:00")), null);
  assert.equal(nextReminderStage(input({ remind_stage: TaskRemindStage.DayBefore }), calendar, vn("2026-10-16T09:00:00")), TaskRemindStage.Due);
  assert.equal(nextReminderStage(input({ remind_stage: TaskRemindStage.Due }), calendar, vn("2026-10-17T09:00:00")), TaskRemindStage.Overdue);
  assert.equal(nextReminderStage(input({ remind_stage: TaskRemindStage.Overdue }), calendar, vn("2026-10-20T09:00:00")), null);
  assert.equal(nextReminderStage(input({ due_at: null }), calendar, vn("2026-10-20T09:00:00")), null);
});

test("bot tắt mấy ngày: chỉ gửi mốc CAO NHẤT, không gửi bù cả ba", () => {
  assert.equal(nextReminderStage(input(), calendar, vn("2026-10-19T09:00:00")), TaskRemindStage.Overdue);
});

test("mốc đã qua TRƯỚC lúc giao / dời hạn thì bỏ — riêng quá hạn luôn gửi", () => {
  // Giao lúc 10:00 T5 (sau mốc «trước hạn» 08:30 T5): T5 không nhắc, T6 nhắc «đúng hạn»
  const lateAssign = input({ baseline: vn("2026-10-15T10:00:00") });
  assert.equal(nextReminderStage(lateAssign, calendar, vn("2026-10-15T11:00:00")), null);
  assert.equal(nextReminderStage(lateAssign, calendar, vn("2026-10-16T08:31:00")), TaskRemindStage.Due);
  // Giao khi đã quá hạn: vẫn nhắc quá hạn
  assert.equal(nextReminderStage(input({ baseline: vn("2026-10-19T10:00:00") }), calendar, vn("2026-10-19T10:01:00")), TaskRemindStage.Overdue);
});

const task = (id: number, overrides: Partial<TaskRow> = {}): TaskRow => ({
  id, code: `V-${id}`, status: TaskStatus.Open, priority: TaskPriority.Normal, title: `Việc ${id}`,
  assignee: { contactId: 1, uid: "u-minh", name: "Minh" }, assigner: { contactId: 2, uid: "u-lan", name: "Lan" }, source: TaskSource.Command,
  source_thread_id: 5, source_message_id: null, due_at: vn("2026-10-16T00:00:00"), due_has_time: false, remind_stage: TaskRemindStage.None,
  resolution: "", created_at: vn("2026-10-09T09:00:00"), ...overrides,
});

test("tin nhắc gộp nhiều việc: nhãn từng mốc, báo rõ khi có việc quá hạn, gợi ý mã thật", () => {
  const now = vn("2026-10-19T09:00:00");
  const text = composeAssigneeReminder([
    { task: task(12), stage: TaskRemindStage.Overdue },
    { task: task(15, { due_at: vn("2026-10-19T00:00:00") }), stage: TaskRemindStage.Due },
  ], now);
  assert.match(text, /^nhắc việc — có việc ĐÃ QUÁ HẠN:/);
  assert.match(text, /- V-12 Việc 12 — hạn T6 16\/10 \(QUÁ HẠN 2 NGÀY\)/);
  assert.match(text, /- V-15 Việc 15 — hạn T2 19\/10 \(tới hạn hôm nay\)/);
  assert.match(text, /«xong V-12»/);
});

test("báo quá hạn cho sếp / người giao: kèm người phụ trách + tên nhóm", () => {
  const text = composeOverdueReport([{ task: task(12), stage: TaskRemindStage.Overdue }], vn("2026-10-19T09:00:00"), new Map([[5, "K52 Bán hàng"]]), false);
  assert.match(text, /^VIỆC QUÁ HẠN \(1\)/);
  assert.match(text, /V-12 Việc 12 — Minh — hạn T6 16\/10 \(QUÁ HẠN 2 NGÀY\) \[K52 Bán hàng\]/);
  assert.match(composeOverdueReport([{ task: task(12, { assignee: null }), stage: TaskRemindStage.Overdue }], vn("2026-10-19T09:00:00"), new Map(), true),
    /^VIỆC ANH\/CHỊ GIAO ĐÃ QUÁ HẠN[\s\S]*chưa có người phụ trách/);
});
