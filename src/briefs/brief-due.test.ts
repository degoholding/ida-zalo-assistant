import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_HOLIDAYS, DEFAULT_QUIET_HOURS, DEFAULT_WORK_DAYS, DEFAULT_WORK_HOURS } from "../config.js";
import { BriefKind } from "../constants.js";
import { buildWorkCalendar } from "../schedule/work-calendar.js";
import { isDailyBriefDue, isPeriodicReportDue, parseDailyBriefTime } from "./brief-due.js";

// Lịch IDA mặc định: T2–T7 làm việc, Chủ nhật nghỉ, lễ 01/01, 30/04, 01/05, 02/09; yên lặng 21:00–06:30
const calendar = buildWorkCalendar({ workHours: DEFAULT_WORK_HOURS, workDays: DEFAULT_WORK_DAYS, quietHours: DEFAULT_QUIET_HOURS, holidays: DEFAULT_HOLIDAYS });
const vn = (text: string) => new Date(`${text}+07:00`);

test("parseDailyBriefTime: rỗng / sai dạng → null; hợp lệ → số phút", () => {
  assert.equal(parseDailyBriefTime(""), null);
  assert.equal(parseDailyBriefTime("  "), null);
  assert.equal(parseDailyBriefTime("7:30pm"), null);
  assert.equal(parseDailyBriefTime("25:00"), null);
  assert.equal(parseDailyBriefTime("07:30"), 450);
  assert.equal(parseDailyBriefTime("7:30"), 450);
});

test("isDailyBriefDue: giờ hẹn rỗng → luôn false (tắt)", () => {
  assert.equal(isDailyBriefDue(BriefKind.Morning, "", vn("2026-10-09T07:30:00"), calendar), false);
});

test("isDailyBriefDue: giờ hẹn sai dạng → false", () => {
  assert.equal(isDailyBriefDue(BriefKind.Morning, "bảy giờ rưỡi", vn("2026-10-09T07:30:00"), calendar), false);
});

test("isDailyBriefDue: Chủ nhật (ngày nghỉ) → false dù đúng giờ", () => {
  assert.equal(isDailyBriefDue(BriefKind.Morning, "07:30", vn("2026-10-11T07:30:00"), calendar), false); // 11/10/2026 là CN
});

test("isDailyBriefDue: ngày lễ (02/09) → false dù đúng giờ", () => {
  assert.equal(isDailyBriefDue(BriefKind.Morning, "07:30", vn("2026-09-02T07:30:00"), calendar), false);
});

test("isDailyBriefDue: trước giờ hẹn → false", () => {
  assert.equal(isDailyBriefDue(BriefKind.Morning, "07:30", vn("2026-10-09T07:00:00"), calendar), false);
});

test("isDailyBriefDue: đúng giờ hẹn → true", () => {
  assert.equal(isDailyBriefDue(BriefKind.Morning, "07:30", vn("2026-10-09T07:30:00"), calendar), true);
});

test("isDailyBriefDue: sáng — bù tới 11:59 (true), qua 12:01 thì bỏ lượt (false)", () => {
  assert.equal(isDailyBriefDue(BriefKind.Morning, "07:30", vn("2026-10-09T11:59:00"), calendar), true);
  assert.equal(isDailyBriefDue(BriefKind.Morning, "07:30", vn("2026-10-09T12:01:00"), calendar), false);
});

test("isDailyBriefDue: cuối ngày — bù tới trước giờ yên lặng (20:59 true), vào giờ yên lặng thì bỏ lượt (21:05 false)", () => {
  assert.equal(isDailyBriefDue(BriefKind.Evening, "17:30", vn("2026-10-09T20:59:00"), calendar), true);
  assert.equal(isDailyBriefDue(BriefKind.Evening, "17:30", vn("2026-10-09T21:05:00"), calendar), false);
});

test("isDailyBriefDue: cuối ngày đúng giờ hẹn → true", () => {
  assert.equal(isDailyBriefDue(BriefKind.Evening, "17:30", vn("2026-10-09T17:30:00"), calendar), true);
});

// Báo cáo tuần: T2 ISO, 08:00. Tuần 05/10–11/10/2026 → Thứ 2 = 05/10; tuần 12/10–18/10 → Thứ 2 = 12/10 (không nghỉ).
test("isPeriodicReportDue: tuần — trước 08:00 T2 thì chưa tới hạn", () => {
  assert.equal(isPeriodicReportDue(BriefKind.Weekly, vn("2026-10-12T07:59:00"), calendar), false);
});

test("isPeriodicReportDue: tuần — đúng 08:00 T2 (ngày làm việc) → true", () => {
  assert.equal(isPeriodicReportDue(BriefKind.Weekly, vn("2026-10-12T08:00:00"), calendar), true);
});

test("isPeriodicReportDue: tuần — ngày khác T2 trong tuần → false dù đúng giờ", () => {
  assert.equal(isPeriodicReportDue(BriefKind.Weekly, vn("2026-10-13T08:00:00"), calendar), false); // Thứ 3
});

test("isPeriodicReportDue: tuần — bù tới trước giờ yên lặng (20:59 true), vào giờ yên lặng thì bỏ lượt (21:05 false)", () => {
  assert.equal(isPeriodicReportDue(BriefKind.Weekly, vn("2026-10-12T20:59:00"), calendar), true);
  assert.equal(isPeriodicReportDue(BriefKind.Weekly, vn("2026-10-12T21:05:00"), calendar), false);
});

test("isPeriodicReportDue: tuần — T2 rơi ngày nghỉ thì dời sang ngày làm việc kế tiếp, đúng T2 đó false", () => {
  // 05/10/2026 là Thứ 2 của tuần 05/10–11/10 — nghỉ riêng cho test này; ngày làm việc kế tiếp là 06/10
  const withHoliday = buildWorkCalendar({ workHours: DEFAULT_WORK_HOURS, workDays: DEFAULT_WORK_DAYS, quietHours: DEFAULT_QUIET_HOURS, holidays: "05/10/2026" });
  assert.equal(isPeriodicReportDue(BriefKind.Weekly, vn("2026-10-05T08:00:00"), withHoliday), false);
  assert.equal(isPeriodicReportDue(BriefKind.Weekly, vn("2026-10-06T08:00:00"), withHoliday), true);
});

// Báo cáo tháng: ngày làm việc đầu tiên từ ngày 3, 08:00. Tháng 10/2026 → ngày 3 = Thứ 7 (ngày làm việc theo lịch mặc định).
test("isPeriodicReportDue: tháng — đúng 08:00 ngày 3 (ngày làm việc) → true", () => {
  assert.equal(isPeriodicReportDue(BriefKind.Monthly, vn("2026-10-03T08:00:00"), calendar), true);
});

test("isPeriodicReportDue: tháng — ngày khác ngày 3 → false dù đúng giờ", () => {
  assert.equal(isPeriodicReportDue(BriefKind.Monthly, vn("2026-10-04T08:00:00"), calendar), false);
});

test("isPeriodicReportDue: tháng — ngày 3 rơi ngày nghỉ thì dời sang ngày làm việc kế tiếp", () => {
  // Ngày 3 tháng 11/2026 là Thứ 3 — nghỉ riêng cho test này; ngày làm việc kế tiếp là 04/11
  const withHoliday = buildWorkCalendar({ workHours: DEFAULT_WORK_HOURS, workDays: DEFAULT_WORK_DAYS, quietHours: DEFAULT_QUIET_HOURS, holidays: "03/11/2026" });
  assert.equal(isPeriodicReportDue(BriefKind.Monthly, vn("2026-11-03T08:00:00"), withHoliday), false);
  assert.equal(isPeriodicReportDue(BriefKind.Monthly, vn("2026-11-04T08:00:00"), withHoliday), true);
});
