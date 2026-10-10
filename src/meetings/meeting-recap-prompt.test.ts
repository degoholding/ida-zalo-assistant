import assert from "node:assert/strict";
import { test } from "node:test";
import { RecapJsonParseError, buildRecapInstruction, parseRecapJson } from "./meeting-recap-prompt.js";

test("parseRecapJson: đọc JSON thuần", () => {
  const result = parseRecapJson('{"title":"Giao ban K52","tldr":["a","b"]}');
  assert.deepEqual(result, { title: "Giao ban K52", tldr: ["a", "b"] });
});

test("parseRecapJson: chịu được bọc ```json ... ``` và chữ thừa trước/sau", () => {
  const text = 'Dạ đây là recap:\n```json\n{"title":"X"}\n```\nCảm ơn.';
  assert.deepEqual(parseRecapJson(text), { title: "X" });
});

test("parseRecapJson: không có JSON → ném RecapJsonParseError", () => {
  assert.throws(() => parseRecapJson("Xin lỗi, em không nghe rõ nội dung cuộc họp."), RecapJsonParseError);
});

test("parseRecapJson: JSON hỏng (thiếu dấu đóng) → ném RecapJsonParseError", () => {
  assert.throws(() => parseRecapJson('{"title": "X"'), RecapJsonParseError);
});

test("parseRecapJson: mảng JSON (không phải đối tượng) → ném RecapJsonParseError", () => {
  assert.throws(() => parseRecapJson("[1,2,3]"), RecapJsonParseError);
});

test("buildRecapInstruction: không có tên thành viên thì giữ nguyên câu lệnh gốc", () => {
  assert.equal(buildRecapInstruction([]), buildRecapInstruction([]));
  assert.ok(!buildRecapInstruction([]).includes("Tên thành viên"));
});

test("buildRecapInstruction: có tên thành viên thì thêm gợi ý khớp tên, tối đa 80 người", () => {
  const instruction = buildRecapInstruction(["Nguyễn Văn A", "Trần Thị B"]);
  assert.ok(instruction.includes("Nguyễn Văn A, Trần Thị B"));
  const many = Array.from({ length: 100 }, (_, i) => `Người ${i}`);
  const result = buildRecapInstruction(many);
  assert.ok(result.includes("Người 79") && !result.includes("Người 80,"));
});
