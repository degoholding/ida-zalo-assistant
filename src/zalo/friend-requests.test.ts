import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeVietnamesePhone, startOfVietnamDay } from "./friend-requests.js";

describe("số điện thoại tra Zalo", () => {
  test("accepts the usual Vietnamese mobile spellings and returns the 84-prefixed form findUser expects", () => {
    for (const raw of ["0912345678", "0912 345 678", "0912.345.678", "091-234-5678", "+84 912 345 678", "84912345678", "0084912345678", "912345678", " (0912) 345678 "]) {
      assert.equal(normalizeVietnamesePhone(raw), "84912345678", raw);
    }
    assert.equal(normalizeVietnamesePhone("0389999999"), "84389999999");
  });

  test("rejects empty, too short, too long, letters, landlines and non-mobile prefixes", () => {
    for (const raw of ["", "   ", "091234567", "09123456789", "0912345abc", "02838123456", "0112345678", "+1 650 555 0100", "0".repeat(50), "84 0912345678"]) {
      assert.equal(normalizeVietnamesePhone(raw), null, raw);
    }
  });
});

describe("ngày Việt Nam cho trần lời mời", () => {
  test("a request at 23:30 UTC belongs to the next Vietnamese day", () => {
    // 23:30 UTC ngày 07/10 = 06:30 sáng 08/10 giờ Việt Nam → ngày bắt đầu 17:00 UTC ngày 07/10
    assert.equal(startOfVietnamDay(new Date("2026-10-07T23:30:00Z")).toISOString(), "2026-10-07T17:00:00.000Z");
  });

  test("16:59 UTC is still the previous Vietnamese day, 17:00 UTC starts a new one", () => {
    assert.equal(startOfVietnamDay(new Date("2026-10-08T16:59:59.999Z")).toISOString(), "2026-10-07T17:00:00.000Z");
    assert.equal(startOfVietnamDay(new Date("2026-10-08T17:00:00.000Z")).toISOString(), "2026-10-08T17:00:00.000Z");
  });
});
