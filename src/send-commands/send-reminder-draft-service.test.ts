import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { planReminder } from "./send-reminder-draft-service.js";

// Giờ nhắc + kiểu lặp: ≥ 1 phút tới, ≤ 366 ngày, thiếu múi giờ hiểu là giờ Việt Nam. Hàm thuần — không cần DB.

const NOW = new Date("2026-10-12T02:00:00Z"); // 09:00 VN

describe("planReminder", () => {
  test("giờ hợp lệ có +07:00: trả đúng mốc, mặc định không lặp", () => {
    const plan = planReminder("2026-10-13T08:00:00+07:00", "", NOW);
    assert.ok(!("error" in plan));
    assert.equal(plan.at.toISOString(), "2026-10-13T01:00:00.000Z");
    assert.equal(plan.repeat, 0);
  });

  test("thiếu múi giờ: hiểu là giờ Việt Nam", () => {
    const plan = planReminder("2026-10-13T08:00", "weekly", NOW);
    assert.ok(!("error" in plan));
    assert.equal(plan.at.toISOString(), "2026-10-13T01:00:00.000Z");
    assert.equal(plan.repeat, 2);
  });

  test("cắt giây / mili-giây: giờ Zalo nhận đúng giờ:phút bản xem trước hiện", () => {
    const plan = planReminder("2026-10-13T08:00:45.500+07:00", "", NOW);
    assert.ok(!("error" in plan));
    assert.equal(plan.at.toISOString(), "2026-10-13T01:00:00.000Z");
  });

  test("kiểu lặp lạ (kể cả tên thuộc tính có sẵn của Object) bị từ chối", () => {
    for (const mode of ["yearly", "constructor", "toString"]) assert.ok("error" in planReminder("2026-10-13T08:00:00+07:00", mode, NOW), mode);
  });

  test("bốn kiểu lặp ra đúng mã Zalo", () => {
    const codes = ["none", "daily", "weekly", "monthly"].map((mode) => {
      const plan = planReminder("2026-10-13T08:00:00+07:00", mode, NOW);
      return "error" in plan ? -1 : plan.repeat;
    });
    assert.deepEqual(codes, [0, 1, 2, 3]);
  });

  test("giờ đã qua hoặc cách chưa tới 1 phút bị từ chối", () => {
    assert.match((planReminder("2026-10-12T08:00:00+07:00", "none", NOW) as { error: string }).error, /đã qua hoặc quá sát/);
    assert.match((planReminder("2026-10-12T09:00:30+07:00", "none", NOW) as { error: string }).error, /đã qua hoặc quá sát/);
    assert.ok(!("error" in planReminder("2026-10-12T09:01:00+07:00", "none", NOW)));
  });

  test("xa quá 366 ngày bị từ chối; đúng 366 ngày còn được", () => {
    assert.match((planReminder("2027-10-14T09:00:00+07:00", "none", NOW) as { error: string }).error, /366 ngày/);
    assert.ok(!("error" in planReminder("2027-10-13T09:00:00+07:00", "none", NOW)));
  });

  test("giờ không đọc được hoặc kiểu lặp lạ bị từ chối", () => {
    assert.match((planReminder("sáng mai", "none", NOW) as { error: string }).error, /chưa hiểu giờ/);
    assert.match((planReminder("", "none", NOW) as { error: string }).error, /chưa hiểu giờ/);
    assert.match((planReminder("2026-10-13T08:00:00+07:00", "yearly", NOW) as { error: string }).error, /Kiểu lặp/);
  });
});
