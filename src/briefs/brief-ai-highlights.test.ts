import assert from "node:assert/strict";
import { test } from "node:test";
import { HighlightCache, parseHighlightAnswer, sanitizeHighlightText } from "./brief-ai-highlights.js";

test("parseHighlightAnswer: đúng JSON → trả id + ý, cắt theo maxPoints", () => {
  const text = '[{"id": 12, "y": "khách giận vì hàng lỗi"}, {"id": 13, "y": "công nợ quá hạn 2 đại lý"}, {"id": 14, "y": "ba"}]';
  assert.deepEqual(parseHighlightAnswer(text, 2), [{ id: 12, text: "khách giận vì hàng lỗi" }, { id: 13, text: "công nợ quá hạn 2 đại lý" }]);
});

test("parseHighlightAnswer: bọc trong ```json ... ``` vẫn đọc được", () => {
  const text = '```json\n[{"id": 1, "y": "ý một"}]\n```';
  assert.deepEqual(parseHighlightAnswer(text, 5), [{ id: 1, text: "ý một" }]);
});

test("parseHighlightAnswer: JSON hỏng / không phải mảng → rỗng", () => {
  assert.deepEqual(parseHighlightAnswer("không phải JSON", 3), []);
  assert.deepEqual(parseHighlightAnswer("{\"id\": 1}", 3), []);
  assert.deepEqual(parseHighlightAnswer("[1, 2, 3]", 3), []);
});

test("parseHighlightAnswer: bỏ phần tử thiếu id / id không phải số nguyên / ý rỗng", () => {
  const text = '[{"id": "x", "y": "a"}, {"y": "thiếu id"}, {"id": 5, "y": ""}, {"id": 6, "y": "ổn"}]';
  assert.deepEqual(parseHighlightAnswer(text, 10), [{ id: 6, text: "ổn" }]);
});

test("parseHighlightAnswer: cắt ý dài quá 80 ký tự (phòng hờ mô hình không theo đúng «≤ 20 chữ»)", () => {
  const longText = "a".repeat(100);
  const [point] = parseHighlightAnswer(`[{"id": 1, "y": "${longText}"}]`, 3);
  assert.equal(point.text.length, 80);
});

// sanitizeHighlightText — review phase 8, M10: chữ mô hình tự viết không được tin y nguyên (tiêm lệnh / rò số liệu).
test("sanitizeHighlightText: chữ bình thường giữ nguyên", () => {
  assert.equal(sanitizeHighlightText("khách giận vì hàng lỗi"), "khách giận vì hàng lỗi");
});

test("sanitizeHighlightText: che SĐT còn sót trong chữ mô hình viết", () => {
  assert.equal(sanitizeHighlightText("gọi anh Nam 0912345678 gấp"), "gọi anh Nam [SĐT ***678] gấp");
});

test("sanitizeHighlightText: bỏ hẳn ý có link (nghi tiêm lệnh / lộ dữ liệu)", () => {
  assert.equal(sanitizeHighlightText("xem thêm tại http://evil.example/steal"), null);
  assert.equal(sanitizeHighlightText("vào www.example.com đọc tiếp"), null);
});

test("sanitizeHighlightText: bỏ hẳn ý có dãy số dài không được maskPersonalData nhận diện", () => {
  assert.equal(sanitizeHighlightText("mã đơn hàng 1234567890123"), null);
});

test("HighlightCache: cùng khóa chỉ tính một lần (đệm theo phạm vi trong cùng lượt chạy)", async () => {
  const cache = new HighlightCache();
  let calls = 0;
  const compute = async () => {
    calls += 1;
    return { highlights: [], note: "" };
  };
  await cache.get("k1", compute);
  await cache.get("k1", compute);
  await cache.get("k2", compute);
  assert.equal(calls, 2);
});
