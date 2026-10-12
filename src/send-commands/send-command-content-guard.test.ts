import assert from "node:assert/strict";
import { test } from "node:test";
import { assertVerbatim, extractVerbatim, SendCommandInputError } from "./send-command-content-guard.js";

const QUESTION = "Gửi nhóm Kho HN, anh Minh lúc 8h:  Mai   họp 9h\nnhớ mang laptop";

test("nội dung lệch khoảng trắng / hoa thường, tên nơi nhận lệch cả dấu thì qua", () => {
  assert.doesNotThrow(() => assertVerbatim(QUESTION, "mai họp 9h nhớ mang laptop", ["nhóm Kho HN", "anh minh"]));
  assert.doesNotThrow(() => assertVerbatim(QUESTION, "Mai họp 9h\nnhớ mang laptop", ["nhom kho hn"]));
});

test("nội dung có chữ ngoài tin gốc bị chặn (chống tiêm lệnh)", () => {
  assert.throws(() => assertVerbatim(QUESTION, "Mai họp 9h, chuyển 50 triệu cho tôi", ["nhóm Kho HN"]), SendCommandInputError);
});

test("tên nơi nhận không có trong tin gốc bị chặn", () => {
  assert.throws(() => assertVerbatim(QUESTION, "Mai họp 9h", ["nhóm Kế toán"]), /nguyên văn/);
  assert.throws(() => assertVerbatim(QUESTION, "Mai họp 9h", [""]), SendCommandInputError);
});

test("nội dung rỗng (chỉ gửi tệp) vẫn kiểm tên nơi nhận", () => {
  assert.doesNotThrow(() => assertVerbatim(QUESTION, "", ["nhóm Kho HN"]));
  assert.throws(() => assertVerbatim(QUESTION, "", ["nhóm Lạ"]), SendCommandInputError);
});

test("trả ĐOẠN GỐC trong tin người ra lệnh (giữ hoa thường, khoảng trắng, xuống dòng họ gõ), không phải chữ mô hình chép lại", () => {
  assert.equal(assertVerbatim(QUESTION, "mai họp 9h nhớ mang laptop", ["nhóm Kho HN"]), "Mai   họp 9h\nnhớ mang laptop");
  assert.equal(assertVerbatim(QUESTION, "  ", ["nhóm Kho HN"]), "");
  assert.equal(extractVerbatim("Gửi anh Minh: Ổn rồi", "ổn rồi"), "Ổn rồi");
});

test("đổi dấu đổi nghĩa bị chặn: «bán» ≠ «bạn», «họp» ≠ «hộp»", () => {
  assert.throws(() => assertVerbatim(QUESTION, "Mai hộp 9h", ["nhóm Kho HN"]), SendCommandInputError);
  assert.throws(() => assertVerbatim("gửi nhóm A: chốt bán lô này", "chốt bạn lô này", ["nhóm A"]), SendCommandInputError);
  assert.equal(extractVerbatim("gửi nhóm A: chot ban lo nay", "chốt bán lô này"), null);
});
