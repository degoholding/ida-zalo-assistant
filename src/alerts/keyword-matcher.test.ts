import assert from "node:assert/strict";
import { test } from "node:test";
import { matchKeywords, parseKeywordList } from "./keyword-matcher.js";

// Danh sách IDA trả lời câu 6 (07/10/2026)
const sets = {
  urgent: parseKeywordList("gấp, khẩn, trả hàng, đổi hàng, khiếu nại, khởi kiện, hàng giả, hàng lỗi, vón cục, cháy lá, chết cây, ngộ độc, thanh tra, quản lý thị trường, ngừng lấy hàng, giận, chửi, mắng vốn, lập tức"),
  important: parseKeywordList("công nợ, quá hạn, khất nợ, gia hạn nợ, chiết khấu, hóa đơn, giao trễ, thiếu hàng, hết hàng, đề nghị duyệt, cận date"),
  strict: parseKeywordList("la, liền, ngay"),
};

test("urgent keywords match with or without diacritics, as whole words or phrases", () => {
  assert.deepEqual(matchKeywords("Đại lý báo hàng bị VÓN CỤC, khiếu nại gấp", sets).urgent.sort(), ["gấp", "khiếu nại", "vón cục"]);
  assert.deepEqual(matchKeywords("dai ly khieu nai chay la het roi", sets).urgent.sort(), ["cháy lá", "khiếu nại"]);
  assert.deepEqual(matchKeywords("Đại lý KHIẾU NẠI", sets).urgent, ["khiếu nại"]);
  assert.deepEqual(matchKeywords("Bên quản lý thị trường xuống kiểm", sets).urgent, ["quản lý thị trường"]);
});

test("a keyword glued inside a longer token does not count", () => {
  // So nguyên từ: «hàng giả» không khớp «hanggia.com», «trả hàng» không khớp «tra hangmoi»
  assert.deepEqual(matchKeywords("hanggia.com", sets).urgent, []);
  assert.deepEqual(matchKeywords("giaodich tra hangmoi", sets).urgent, []);
  assert.deepEqual(matchKeywords("chiếtkhấu", sets).important, []);
});

test("strict words need the exact accents: «la» never matches là / lá / lại", () => {
  assert.deepEqual(matchKeywords("Hôm nay là thứ hai, lá xanh, gửi lại nhé", sets).strict, []);
  assert.deepEqual(matchKeywords("Khách la quá trời", sets).strict, ["la"]);
  assert.deepEqual(matchKeywords("anh gửi LIỀN cho em", sets).strict, ["liền"]);
  assert.deepEqual(matchKeywords("làm ngay đi", sets).strict, ["ngay"]);
  // Không dấu thì không tính (lien / ngay không dấu trùng quá nhiều từ khác)
  assert.deepEqual(matchKeywords("anh gui lien cho em", sets).strict, []);
});

test("words that only collide once accents are dropped are not matched in accented text", () => {
  // «gặp» bỏ dấu = «gap» = «gấp»; «gian hàng» bỏ dấu chứa «gian» = «giận»
  const match = matchKeywords("Chiều nay gặp anh ở gian hàng hội chợ", sets);
  assert.deepEqual(match, { urgent: [], important: [], strict: [] });
});

test("unaccented text: phrases match directly, single urgent words only become AI candidates", () => {
  const match = matchKeywords("dai ly khieu nai, can gap", sets);
  assert.deepEqual(match.urgent, ["khiếu nại"]);
  assert.deepEqual(match.strict, ["gấp"]);
  // Từ quan trọng một chữ không dấu thì bỏ hẳn (không có ứng viên quan trọng)
  assert.deepEqual(matchKeywords("hoa don thang nay", { ...sets, important: ["hóa đơn", "nợ"] }).important, ["hóa đơn"]);
});

test("important keywords and empty text", () => {
  assert.deepEqual(matchKeywords("nhắc công nợ quá hạn của đại lý A", sets).important.sort(), ["công nợ", "quá hạn"]);
  assert.deepEqual(matchKeywords("", sets), { urgent: [], important: [], strict: [] });
});

test("the settings list is split, trimmed, lower-cased and de-duplicated", () => {
  assert.deepEqual(parseKeywordList(" Gấp ,gấp;KHẨN\n\n , "), ["gấp", "khẩn"]);
  assert.deepEqual(parseKeywordList(""), []);
});
