import assert from "node:assert/strict";
import { test } from "node:test";
import { DataAccessError } from "./data-access-errors.js";
import { admin, makeCtx } from "./data-access-test-support.js";
import { assertNoPersonalNumberProbe, longestDigitRun, MIN_DIGITS_PROBE } from "./masked-filter-guard.js";

const masked = () => makeCtx(admin(), { maskPersonal: true });
const unmasked = () => makeCtx(admin(), { maskPersonal: false });

const ALLOWED = ["12345", "2024", "DH-20241018", "DH-12345678", "12345678", "1234 5678", "báo giá 123", "abc"];
const BLOCKED = ["123456789", "0912345678", "0912 345 678", "0912.345.678", "0912-345-678", "+84 912 345 678", "012345678912", "STK 123456789"];

test("ngưỡng dò số = 9 chữ số", () => assert.equal(MIN_DIGITS_PROBE, 9));

test("longestDigitRun bỏ dấu phân cách giữa số nhưng không nối qua chữ", () => {
  assert.equal(longestDigitRun("0912 345 678"), 10);
  assert.equal(longestDigitRun("DH-12345678"), 8);
  assert.equal(longestDigitRun("12345678 abc 1234"), 8);
});

test("che bật: dãy ≤ 8 chữ số (mã đơn, năm) được phép", () => {
  for (const value of ALLOWED) assert.doesNotThrow(() => assertNoPersonalNumberProbe(masked(), "text", value), value);
});

test("che bật: dãy ≥ 9 chữ số (SĐT, CCCD, STK, có dấu phân cách) bị chặn invalid_value nêu «9 chữ số»", () => {
  for (const value of BLOCKED) {
    assert.throws(() => assertNoPersonalNumberProbe(masked(), "text", value),
      (error) => error instanceof DataAccessError && error.code === "invalid_value" && /9 chữ số/.test(error.message), value);
  }
});

test("che tắt hoặc giá trị không phải chuỗi: không chặn gì", () => {
  for (const value of [...ALLOWED, ...BLOCKED]) assert.doesNotThrow(() => assertNoPersonalNumberProbe(unmasked(), "text", value), value);
  assert.doesNotThrow(() => assertNoPersonalNumberProbe(masked(), "thread_id", 1234567890123));
});
