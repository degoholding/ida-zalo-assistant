import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWorkCalendar, CalendarInputError, parseHolidays, parseTimeRanges, parseWorkDays } from "./work-calendar.js";

// Mốc giờ Việt Nam viết rõ múi +07:00 để bài kiểm không phụ thuộc máy chạy
const vn = (text: string) => new Date(`${text}+07:00`);

// Lịch IDA chốt 07/10/2026: 08:30–12:00, 13:30–17:30, thứ 2–7; yên lặng 21:00–06:30; lễ cố định + Tết 2027
const ida = buildWorkCalendar({
  workHours: "08:30-12:00, 13:30-17:30",
  workDays: [1, 2, 3, 4, 5, 6],
  quietHours: "21:00-06:30",
  holidays: "01/01, 30/04, 01/05, 02/09, 05/02/2027-11/02/2027",
});

test("working time follows both ranges and skips the lunch break", () => {
  assert.equal(ida.isWorkingTime(vn("2026-10-08T08:29:59")), false);
  assert.equal(ida.isWorkingTime(vn("2026-10-08T08:30:00")), true);
  assert.equal(ida.isWorkingTime(vn("2026-10-08T12:00:00")), false);
  assert.equal(ida.isWorkingTime(vn("2026-10-08T13:30:00")), true);
  assert.equal(ida.isWorkingTime(vn("2026-10-08T17:29:00")), true);
  assert.equal(ida.isWorkingTime(vn("2026-10-08T17:30:00")), false);
});

test("Saturday is a working day for IDA, Sunday and holidays are not", () => {
  assert.equal(ida.isWorkingDay(vn("2026-10-10T10:00:00")), true);
  assert.equal(ida.isWorkingDay(vn("2026-10-11T10:00:00")), false);
  assert.equal(ida.isWorkingDay(vn("2026-09-02T10:00:00")), false);
  assert.equal(ida.isWorkingDay(vn("2027-02-08T10:00:00")), false);
  assert.equal(ida.isWorkingDay(vn("2027-02-12T10:00:00")), true);
});

test("the Vietnam date is used, not the UTC date — 06:00 VN is still the same VN day", () => {
  // 06:00 sáng thứ 2 ở VN là 23:00 Chủ nhật theo UTC
  assert.equal(ida.isWorkingDay(vn("2026-10-12T06:00:00")), true);
});

test("quiet hours wrap past midnight, and a whole Sunday or holiday counts as quiet", () => {
  assert.equal(ida.isQuietTime(vn("2026-10-08T20:59:00")), false);
  assert.equal(ida.isQuietTime(vn("2026-10-08T21:00:00")), true);
  assert.equal(ida.isQuietTime(vn("2026-10-09T03:00:00")), true);
  assert.equal(ida.isQuietTime(vn("2026-10-09T06:30:00")), false);
  assert.equal(ida.isQuietTime(vn("2026-10-11T14:00:00")), true);
  assert.equal(ida.isQuietTime(vn("2026-04-30T10:00:00")), true);
});

test("the waiting clock only runs during working hours", () => {
  // 2 giờ từ 09:00 → 11:00 cùng buổi
  assert.deepEqual(ida.addWorkingMinutes(vn("2026-10-08T09:00:00"), 120), vn("2026-10-08T11:00:00"));
  // 11:00 + 2 giờ: còn 1 giờ buổi sáng, nghỉ trưa, thêm 1 giờ buổi chiều → 14:30
  assert.deepEqual(ida.addWorkingMinutes(vn("2026-10-08T11:00:00"), 120), vn("2026-10-08T14:30:00"));
  // Tin tới lúc 22:00 (ngoài giờ) → bắt đầu đếm từ 08:30 sáng hôm sau
  assert.deepEqual(ida.addWorkingMinutes(vn("2026-10-08T22:00:00"), 30), vn("2026-10-09T09:00:00"));
  // Thứ 7 17:00 + 2 giờ: còn 30 phút, bỏ Chủ nhật → thứ 2 10:00
  assert.deepEqual(ida.addWorkingMinutes(vn("2026-10-10T17:00:00"), 120), vn("2026-10-12T10:00:00"));
  // Trong kỳ nghỉ Tết → sau Tết
  assert.deepEqual(ida.addWorkingMinutes(vn("2027-02-06T10:00:00"), 60), vn("2027-02-12T09:30:00"));
});

test("zero minutes from inside working hours is now, from outside is the next opening", () => {
  assert.deepEqual(ida.addWorkingMinutes(vn("2026-10-08T09:15:00"), 0), vn("2026-10-08T09:15:00"));
  assert.deepEqual(ida.addWorkingMinutes(vn("2026-10-08T12:30:00"), 0), vn("2026-10-08T13:30:00"));
  assert.deepEqual(ida.addWorkingMinutes(vn("2026-10-08T09:15:00"), -50), vn("2026-10-08T09:15:00"));
});

test("a calendar where every day is a holiday never comes due instead of looping forever", () => {
  const closed = buildWorkCalendar({ workHours: "08:00-17:00", workDays: [1], quietHours: "21:00-06:00", holidays: "01/01/2026-31/12/2028" });
  assert.equal(closed.addWorkingMinutes(vn("2026-10-08T09:00:00"), 60), null);
});

test("bad setting text is rejected with a message the admin can act on", () => {
  assert.throws(() => parseTimeRanges("8:30 tới 12:00", false), CalendarInputError);
  assert.throws(() => parseTimeRanges("17:30-08:30", false), /kết thúc trước/);
  assert.throws(() => parseTimeRanges("25:00-26:00", false), /hợp lệ/);
  assert.throws(() => parseTimeRanges("08:00-08:00", false), /trùng/);
  assert.deepEqual(parseTimeRanges("21:00-06:30", true), [{ start: 1260, end: 390 }]);
  assert.deepEqual(parseTimeRanges("", false), []);
  assert.throws(() => parseHolidays("31/02"), /có thật/);
  assert.throws(() => parseHolidays("10/02/2027-05/02/2027"), /trước/);
  assert.deepEqual(parseHolidays("29/02"), [{ kind: "yearly", day: 29, month: 2 }]);
  assert.throws(() => parseWorkDays([]), /ít nhất/);
  assert.throws(() => parseWorkDays([0, 8]), /1 \(thứ 2\)/);
  assert.deepEqual(parseWorkDays(["6", "1", "1"]), [1, 6]);
});

test("a calendar with no working ranges never comes due", () => {
  const none = buildWorkCalendar({ workHours: "", workDays: [1, 2], quietHours: "", holidays: "" });
  assert.equal(none.addWorkingMinutes(vn("2026-10-08T09:00:00"), 10), null);
  assert.equal(none.isWorkingTime(vn("2026-10-08T09:00:00")), false);
});
