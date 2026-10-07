import assert from "node:assert/strict";
import { test } from "node:test";
import { formatVn, formatVnDay } from "./tools.js";

test("formatVnDay: thứ + ngày theo giờ Việt Nam, kể cả lúc UTC còn ở ngày hôm trước", () => {
  assert.equal(formatVnDay(new Date("2026-10-07T06:00:00Z")), "thứ Tư, 07/10/2026");
  // 23:30 UTC ngày 06/10 = 06:30 sáng 07/10 giờ VN
  assert.equal(formatVnDay(new Date("2026-10-06T23:30:00Z")), "thứ Tư, 07/10/2026");
  assert.equal(formatVnDay(new Date("2026-10-11T03:00:00Z")), "Chủ nhật, 11/10/2026");
  // Giao thừa: 31/12 UTC 18:00 = 01/01 năm sau giờ VN
  assert.equal(formatVnDay(new Date("2026-12-31T18:00:00Z")), "thứ Sáu, 01/01/2027");
  assert.equal(formatVn(new Date("2026-10-07T06:05:00Z")).slice(6), "13:05");
});
