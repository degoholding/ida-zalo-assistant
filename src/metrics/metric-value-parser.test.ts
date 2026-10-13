import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseSheetDate, parseVnNumber } from "./metric-value-parser.js";

describe("parseSheetDate", () => {
  test("serial number", () => {
    assert.equal(parseSheetDate(46307), "2026-10-12");
    assert.equal(parseSheetDate(46307.75), "2026-10-12");
  });
  test("text formats", () => {
    assert.equal(parseSheetDate("12/10/2026"), "2026-10-12");
    assert.equal(parseSheetDate("2/9/26"), "2026-09-02");
    assert.equal(parseSheetDate("2026-10-12"), "2026-10-12");
  });
  test("invalid", () => {
    assert.equal(parseSheetDate("31/02/2026"), null);
    assert.equal(parseSheetDate("hôm qua"), null);
    assert.equal(parseSheetDate(1234567), null);
    assert.equal(parseSheetDate(null), null);
  });
});

describe("parseVnNumber", () => {
  const v = (cell: unknown) => parseVnNumber(cell);
  test("real numbers", () => assert.deepEqual(v(1234567.5), { value: 1234567.5 }));
  test("Vietnamese thousands", () => {
    assert.deepEqual(v("1.234.567"), { value: 1234567 });
    assert.deepEqual(v("1.234"), { value: 1234 });
    assert.deepEqual(v("1,234,567"), { value: 1234567 });
    assert.deepEqual(v("1.234,5"), { value: 1234.5 });
  });
  test("decimal comma", () => assert.deepEqual(v("1,5"), { value: 1.5 }));
  test("suffixes", () => {
    assert.deepEqual(v("1,2tr"), { value: 1_200_000 });
    assert.deepEqual(v("1,2 triệu"), { value: 1_200_000 });
    assert.deepEqual(v("500k"), { value: 500_000 });
    assert.deepEqual(v("500 nghìn"), { value: 500_000 });
    assert.deepEqual(v("1.5tr"), { value: 1_500_000 });
  });
  test("negatives", () => {
    assert.deepEqual(v("-3"), { value: -3 });
    assert.deepEqual(v("(3)"), { value: -3 });
  });
  test("blank is skipped", () => {
    assert.equal(v(""), null);
    assert.equal(v("   "), null);
    assert.equal(v(undefined), null);
  });
  test("unparsable keeps raw text, never 0", () => {
    assert.deepEqual(v("#REF!"), { unparsed: true, raw: "#REF!" });
    assert.deepEqual(v("#N/A"), { unparsed: true, raw: "#N/A" });
    assert.deepEqual(v("?"), { unparsed: true, raw: "?" });
    assert.deepEqual(v("abc"), { unparsed: true, raw: "abc" });
  });
});

test("review phase 10: ô SỐ khổng lồ (vượt DECIMAL(18,2)) thành «không đọc được», số lẻ làm tròn 2 chữ số", () => {
  assert.ok("unparsed" in (parseVnNumber(1e20) as object));
  assert.deepEqual(parseVnNumber(12.345), { value: 12.35 });
  assert.deepEqual(parseVnNumber(-3), { value: -3 });
});
