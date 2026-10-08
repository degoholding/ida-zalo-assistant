import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSlot, describeSpec } from "./scheduler.js";
import { buildWorkCalendar } from "./work-calendar.js";

const vn = (text: string) => new Date(`${text}+07:00`);
const calendar = buildWorkCalendar({ workHours: "08:30-17:30", workDays: [1, 2, 3, 4, 5, 6], quietHours: "", holidays: "02/09" });

test("a daily job has no slot before its time and the Vietnam date as slot after it", () => {
  const spec = { every: "day", at: "07:30" } as const;
  assert.equal(currentSlot(spec, vn("2026-10-08T07:29:00"), calendar), null);
  assert.equal(currentSlot(spec, vn("2026-10-08T07:30:00"), calendar), "2026-10-08");
  // Bật máy lúc 15:00 mà hôm nay chưa chạy → vẫn còn lượt hôm nay để chạy bù
  assert.equal(currentSlot(spec, vn("2026-10-08T15:00:00"), calendar), "2026-10-08");
  // 23:30 giờ VN vẫn là ngày VN đó, dù UTC đã sang ngày khác? (UTC chậm hơn — kiểm chiều ngược: 00:30 VN = 17:30 UTC hôm trước)
  assert.equal(currentSlot({ every: "day", at: "00:00" }, vn("2026-10-09T00:30:00"), calendar), "2026-10-09");
});

test("a working-days-only job skips Sundays and holidays", () => {
  const spec = { every: "day", at: "07:30", workingDaysOnly: true } as const;
  assert.equal(currentSlot(spec, vn("2026-10-11T08:00:00"), calendar), null);
  assert.equal(currentSlot(spec, vn("2026-09-02T08:00:00"), calendar), null);
  assert.equal(currentSlot(spec, vn("2026-10-10T08:00:00"), calendar), "2026-10-10");
  // Lịch hỏng (null) → coi mọi ngày là ngày làm, không bỏ lượt
  assert.equal(currentSlot(spec, vn("2026-10-11T08:00:00"), null), "2026-10-11");
});

test("weekly and monthly jobs only have a slot on their day, after their time", () => {
  const weekly = { every: "week", weekday: 1, at: "08:00" } as const;
  assert.equal(currentSlot(weekly, vn("2026-10-12T07:59:00"), calendar), null);
  assert.equal(currentSlot(weekly, vn("2026-10-12T08:00:00"), calendar), "w2026-10-12");
  assert.equal(currentSlot(weekly, vn("2026-10-13T08:00:00"), calendar), null);
  const monthly = { every: "month", day: 3, at: "08:00" } as const;
  assert.equal(currentSlot(monthly, vn("2026-11-03T09:00:00"), calendar), "M2026-11");
  assert.equal(currentSlot(monthly, vn("2026-11-04T09:00:00"), calendar), null);
});

test("an interval job changes slot every N minutes and never returns null", () => {
  const spec = { every: "minutes", minutes: 10 } as const;
  const a = currentSlot(spec, vn("2026-10-08T09:00:00"), calendar);
  const b = currentSlot(spec, vn("2026-10-08T09:09:59"), calendar);
  const c = currentSlot(spec, vn("2026-10-08T09:10:00"), calendar);
  assert.equal(a, b);
  assert.notEqual(b, c);
  // Khoảng 0 phút (khai sai) không chia cho 0
  assert.ok(currentSlot({ every: "minutes", minutes: 0 }, vn("2026-10-08T09:00:00"), calendar));
});

test("schedules read naturally on the settings screen", () => {
  assert.equal(describeSpec({ every: "minutes", minutes: 120 }), "mỗi 2 giờ");
  assert.equal(describeSpec({ every: "day", at: "07:30", workingDaysOnly: true }), "hằng ngày 07:30 (ngày làm việc)");
  assert.equal(describeSpec({ every: "week", weekday: 1, at: "08:00" }), "thứ 2 hằng tuần 08:00");
  assert.equal(describeSpec({ every: "month", day: 3, at: "08:00" }), "ngày 3 hằng tháng 08:00");
});
