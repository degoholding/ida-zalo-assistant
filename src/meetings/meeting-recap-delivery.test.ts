import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConfirmLine, composeRecapMessage, type RecapMessageInput } from "./meeting-recap-delivery.js";

const BASE: RecapMessageInput = {
  title: "Giao ban dự án K52", meetingDate: "10/10/2026", duration: "~45 phút", fileName: "giao-ban-k52.mp3",
  tldr: ["Chốt tiến độ tuần tới", "Thiếu hàng kho B", "Khách X khiếu nại giao trễ"], tasks: [], confirmLine: null,
};

test("composeRecapMessage: không có việc nào thì bỏ hẳn phần «Phân công» + hỏi xác nhận", () => {
  const text = composeRecapMessage(BASE);
  assert.ok(text.startsWith('Recap cuộc họp «Giao ban dự án K52» (10/10/2026 ~45 phút) — từ ghi âm «giao-ban-k52.mp3»'));
  assert.ok(!text.includes("Phân công"));
  assert.equal(text.split("\n").length, 4); // header + 3 tldr
});

test("composeRecapMessage: có việc thì thêm «Phân công» + dòng xác nhận, tối đa 14 dòng", () => {
  const tasks = Array.from({ length: 10 }, (_, i) => ({ code: `V-${i + 1}`, owner: `Người ${i}`, title: `Việc ${i}`, due: "T6 16/10" }));
  const text = composeRecapMessage({ ...BASE, tasks, confirmLine: buildConfirmLine("V-1", "@Minh") });
  const lines = text.split("\n");
  assert.ok(lines.length <= 14);
  assert.ok(lines.includes("Phân công:"));
  assert.ok(lines.some((line) => line.startsWith("V-1 Người 0 — Việc 0 — hạn T6 16/10")));
  assert.ok(lines.at(-1)!.includes("@Minh lưu các việc này vào checklist?"));
});

test("composeRecapMessage: không có meetingDate/duration thì không có cặp ngoặc rỗng", () => {
  const text = composeRecapMessage({ ...BASE, meetingDate: "", duration: "" });
  assert.ok(text.startsWith("Recap cuộc họp «Giao ban dự án K52» — từ ghi âm"));
});

test("buildConfirmLine: nêu đúng mã việc đầu tiên + câu «ok hết» / «bỏ hết»", () => {
  const line = buildConfirmLine("V-7", "Anh/chị");
  assert.ok(line.includes("«ok hết»") && line.includes("«ok V-7»") && line.includes("«bỏ hết»"));
  assert.ok(line.startsWith("Anh/chị lưu"));
});
