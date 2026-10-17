import assert from "node:assert/strict";
import { test } from "node:test";
import { dbDateToVnIso, parseVnInstant, spanDays, toVnIso, toVnIsoMs } from "./vn-time.js";

test("parseVnInstant: chỉ có ngày = cả ngày giờ VN (đầu ngày = 17:00 UTC hôm trước)", () => {
  const parsed = parseVnInstant("2026-10-05");
  assert.equal(parsed?.dayOnly, true);
  assert.equal(parsed?.date.toISOString(), "2026-10-04T17:00:00.000Z");
});

test("parseVnInstant: giờ không ghi múi → giờ VN; có múi thì giữ múi", () => {
  assert.equal(parseVnInstant("2026-10-05T09:30")?.date.toISOString(), "2026-10-05T02:30:00.000Z");
  assert.equal(parseVnInstant("2026-10-05 09:30:15.250")?.date.toISOString(), "2026-10-05T02:30:15.250Z");
  assert.equal(parseVnInstant("2026-10-05T09:30:00Z")?.date.toISOString(), "2026-10-05T09:30:00.000Z");
  assert.equal(parseVnInstant("2026-10-05T09:30:00+00:00")?.date.toISOString(), "2026-10-05T09:30:00.000Z");
  assert.equal(parseVnInstant("2026-10-05T09:30:00-05:00")?.date.toISOString(), "2026-10-05T14:30:00.000Z");
  assert.equal(parseVnInstant("2026-10-05T09:30:00+07:00")?.dayOnly, false);
});

test("parseVnInstant: ngày không có thật / sai định dạng → null", () => {
  for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-10-05T25:00", "2026-10-05T10:61", "2026-10-05+07:00", "05/10/2026", "hôm qua", "", "2026-10-05; DROP TABLE x", "2026-10-05T09:30:00+7"]) {
    assert.equal(parseVnInstant(bad), null, bad);
  }
  // Năm nhuận
  assert.ok(parseVnInstant("2028-02-29"));
  assert.equal(parseVnInstant("2027-02-29"), null);
});

test("toVnIso / toVnIsoMs: giờ VN dạng ISO có +07:00, qua nửa đêm đổi ngày", () => {
  assert.equal(toVnIso(new Date("2026-10-16T02:12:04.250Z")), "2026-10-16T09:12:04+07:00");
  assert.equal(toVnIsoMs(new Date("2026-10-16T02:12:04.250Z")), "2026-10-16T09:12:04.250+07:00");
  assert.equal(toVnIso(new Date("2026-10-16T18:00:00Z")), "2026-10-17T01:00:00+07:00");
  assert.equal(toVnIso(new Date("2026-12-31T17:00:00Z")), "2027-01-01T00:00:00+07:00");
});

test("dbDateToVnIso: null / chuỗi hỏng → null, Date → ISO VN", () => {
  assert.equal(dbDateToVnIso(null), null);
  assert.equal(dbDateToVnIso("không phải ngày"), null);
  assert.equal(dbDateToVnIso(new Date("2026-10-16T02:12:04Z")), "2026-10-16T09:12:04+07:00");
});

test("spanDays làm tròn lên", () => {
  assert.equal(spanDays(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-02T00:00:01Z")), 2);
  assert.equal(spanDays(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-02T00:00:00Z")), 1);
});
