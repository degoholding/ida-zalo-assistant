import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_HOLIDAYS, DEFAULT_QUIET_HOURS, DEFAULT_WORK_DAYS, DEFAULT_WORK_HOURS } from "../config.js";
import { BriefKind } from "../constants.js";
import { buildWorkCalendar } from "../schedule/work-calendar.js";
import { briefPeriod } from "./brief-period.js";

// Lịch IDA mặc định: T2–T7 làm việc, Chủ nhật nghỉ, lễ 01/01, 30/04, 01/05, 02/09 (xem config.ts)
const calendar = buildWorkCalendar({ workHours: DEFAULT_WORK_HOURS, workDays: DEFAULT_WORK_DAYS, quietHours: DEFAULT_QUIET_HOURS, holidays: DEFAULT_HOLIDAYS });
const vn = (text: string) => new Date(`${text}+07:00`);
const iso = (at: Date) => at.toISOString();

test("bản tin sáng T2: lấy từ 00:00 ngày làm việc liền trước — T7 (Chủ nhật nghỉ)", () => {
  const period = briefPeriod(BriefKind.Morning, vn("2026-10-12T07:30:00"), calendar);
  assert.equal(iso(period.from), iso(vn("2026-10-10T00:00:00")));
  assert.equal(iso(period.to), iso(vn("2026-10-12T07:30:00")));
  assert.equal(period.periodKey, "2026-10-12");
  assert.equal(period.periodLabel, "Ngày 12/10/2026");
  // Kỳ trước (để so): ngày làm việc liền trước T7 là T6
  assert.equal(iso(period.previous.from), iso(vn("2026-10-09T00:00:00")));
  assert.equal(iso(period.previous.to), iso(vn("2026-10-10T00:00:00")));
});

test("bản tin sáng sau ngày lễ 02/09 (thứ 4): nhảy qua lễ, lấy thứ 3 01/09", () => {
  const period = briefPeriod(BriefKind.Morning, vn("2026-09-03T07:30:00"), calendar);
  assert.equal(iso(period.from), iso(vn("2026-09-01T00:00:00")));
});

test("bản tin cuối ngày: từ 00:00 hôm nay tới giờ soạn", () => {
  const period = briefPeriod(BriefKind.Evening, vn("2026-10-09T17:30:00"), calendar);
  assert.equal(iso(period.from), iso(vn("2026-10-09T00:00:00")));
  assert.equal(iso(period.to), iso(vn("2026-10-09T17:30:00")));
  assert.equal(period.periodKey, "2026-10-09");
  assert.equal(period.periodLabel, "Ngày 09/10/2026");
});

test("báo cáo tuần: tuần ISO T2–CN TRƯỚC, nhãn đúng ví dụ IDA chốt", () => {
  const period = briefPeriod(BriefKind.Weekly, vn("2026-10-12T08:00:00"), calendar);
  assert.equal(iso(period.from), iso(vn("2026-10-05T00:00:00")));
  assert.equal(iso(period.to), iso(vn("2026-10-12T00:00:00")));
  assert.equal(period.periodKey, "2026-W41");
  assert.equal(period.periodLabel, "Tuần 41/2026 (05/10–11/10)");
});

test("báo cáo tuần: tuần ISO qua năm (tuần 53/2026 → tuần 1/2027)", () => {
  const period = briefPeriod(BriefKind.Weekly, vn("2027-01-04T08:00:00"), calendar);
  assert.equal(iso(period.from), iso(vn("2026-12-28T00:00:00")));
  assert.equal(iso(period.to), iso(vn("2027-01-04T00:00:00")));
  assert.equal(period.periodKey, "2026-W53");
  assert.equal(period.periodLabel, "Tuần 53/2026 (28/12–03/01)");
});

test("báo cáo tháng: tháng TRƯỚC — ví dụ IDA chốt (ngày 3 tháng 10 → Tháng 9/2026)", () => {
  const period = briefPeriod(BriefKind.Monthly, vn("2026-10-03T08:00:00"), calendar);
  assert.equal(iso(period.from), iso(vn("2026-09-01T00:00:00")));
  assert.equal(iso(period.to), iso(vn("2026-10-01T00:00:00")));
  assert.equal(period.periodKey, "2026-09");
  assert.equal(period.periodLabel, "Tháng 9/2026");
});

test("báo cáo tháng: tháng 1 → tháng 12 năm trước", () => {
  const period = briefPeriod(BriefKind.Monthly, vn("2027-01-03T08:00:00"), calendar);
  assert.equal(iso(period.from), iso(vn("2026-12-01T00:00:00")));
  assert.equal(iso(period.to), iso(vn("2027-01-01T00:00:00")));
  assert.equal(period.periodKey, "2026-12");
  assert.equal(period.periodLabel, "Tháng 12/2026");
});

test("biến thể «kỳ này»: tuần / tháng tính tới hiện tại thay vì kỳ đã xong", () => {
  const week = briefPeriod(BriefKind.Weekly, vn("2026-10-14T10:00:00"), calendar, "current");
  assert.equal(iso(week.from), iso(vn("2026-10-12T00:00:00")));
  assert.equal(iso(week.to), iso(vn("2026-10-14T10:00:00")));
  assert.equal(week.periodKey, "2026-W42");
  // Nhãn vẫn là cả tuần (T2–CN), kể cả gọi ngay sáng T2
  assert.equal(week.periodLabel, "Tuần 42/2026 (12/10–18/10)");
  assert.equal(briefPeriod(BriefKind.Weekly, vn("2026-10-12T08:00:00"), calendar, "current").periodLabel, "Tuần 42/2026 (12/10–18/10)");

  const month = briefPeriod(BriefKind.Monthly, vn("2026-10-15T10:00:00"), calendar, "current");
  assert.equal(iso(month.from), iso(vn("2026-10-01T00:00:00")));
  assert.equal(iso(month.to), iso(vn("2026-10-15T10:00:00")));
  assert.equal(month.periodKey, "2026-10");
});
