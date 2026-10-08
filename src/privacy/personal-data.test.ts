import assert from "node:assert/strict";
import { test } from "node:test";
import { maskPersonalData, maskPersonalDataDeep } from "./personal-data.js";

test("Vietnamese mobile numbers are masked in every common way of writing them", () => {
  assert.equal(maskPersonalData("gọi 0912345678 nhé"), "gọi [SĐT ***678] nhé");
  assert.equal(maskPersonalData("SĐT: 0912 345 678"), "SĐT: [SĐT ***678]");
  assert.equal(maskPersonalData("đt 091.234.5678"), "đt [SĐT ***678]");
  assert.equal(maskPersonalData("+84912345678"), "[SĐT ***678]");
  assert.equal(maskPersonalData("84 912345678"), "[SĐT ***678]");
  assert.equal(maskPersonalData("0388-123-456"), "[SĐT ***456]");
});

test("money and codes that only look numeric are left alone", () => {
  // Tiền viết liền / có dấu chấm, mã đơn, số lượng — không phải SĐT
  assert.equal(maskPersonalData("doanh số 150000000 đồng"), "doanh số 150000000 đồng");
  assert.equal(maskPersonalData("tổng 1.250.000.000đ"), "tổng 1.250.000.000đ");
  assert.equal(maskPersonalData("mã đơn DH0912345678X"), "mã đơn DH0912345678X");
  assert.equal(maskPersonalData("09123456789 (11 số)"), "09123456789 (11 số)");
  assert.equal(maskPersonalData("0212345678"), "0212345678");
  assert.equal(maskPersonalData("120000000000"), "120000000000");
});

test("a 12-digit citizen id starting with the province zero is masked", () => {
  assert.equal(maskPersonalData("CCCD 079203001234"), "CCCD [CCCD ***234]");
  assert.equal(maskPersonalData("số 0792030012345 dài quá"), "số 0792030012345 dài quá");
});

test("a bank account is masked only when a label says it is one", () => {
  assert.equal(maskPersonalData("STK 0071000123456 VCB"), "STK [STK ***456] VCB");
  assert.equal(maskPersonalData("Số tài khoản: 1903 5555 1234 01"), "Số tài khoản: [STK ***401]");
  assert.equal(maskPersonalData("tk số 19035555123"), "tk số [STK ***123]");
  assert.equal(maskPersonalData("chuyển 19035555123 đồng"), "chuyển 19035555123 đồng");
});

test("empty input and text without numbers pass through unchanged", () => {
  assert.equal(maskPersonalData(""), "");
  assert.equal(maskPersonalData("Dạ em nhận rồi"), "Dạ em nhận rồi");
});

test("deep masking reaches nested strings and leaves numbers and keys untouched", () => {
  const masked = maskPersonalDataDeep({ messages: "Lan: 0912345678", rows: [["Đại lý A", "0987654321", 150000000]], count: 2, ok: true, none: null });
  assert.deepEqual(masked, { messages: "Lan: [SĐT ***678]", rows: [["Đại lý A", "[SĐT ***321]", 150000000]], count: 2, ok: true, none: null });
});
