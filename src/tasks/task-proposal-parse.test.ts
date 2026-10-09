import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSentForPrompt, looksLikeAssignment, parseExtractAnswer } from "./task-proposal-parse.js";

test("looksLikeAssignment: câu giao việc / có @nhắc thì đưa AI; chào hỏi, báo cáo thường thì không", () => {
  for (const text of [
    "Minh gửi báo giá cho đại lý XT trước thứ 6 nhé",
    "nhờ Lan chốt công nợ Minh Phát",
    "anh Duy kiểm tra lại đơn hàng này giúp anh",
    "deadline mai nha em",
    "chị giao Hùng xử lý vụ khiếu nại",
  ]) assert.equal(looksLikeAssignment(text, false), true, text);
  assert.equal(looksLikeAssignment("ok", true), true, "có @nhắc ai đó thì luôn xét");
  for (const text of ["Chào cả nhà", "Hôm nay bán được 20 bao NPK", "Em gửi ảnh hàng về kho ạ", "Cảm ơn anh"]) {
    assert.equal(looksLikeAssignment(text, false), false, text);
  }
});

test("formatSentForPrompt: thứ + ngày giờ Việt Nam để AI tính «mai», «thứ 6»", () => {
  assert.equal(formatSentForPrompt(new Date("2026-10-09T10:15:00+07:00")), "T6 09/10/2026 10:15");
  assert.equal(formatSentForPrompt(new Date("2026-10-11T23:05:00+07:00")), "CN 11/10/2026 23:05");
});

test("parseExtractAnswer: đọc mảng JSON kể cả bọc ```json```, bỏ @ ở tên, han null / «null» = không hạn", () => {
  const answer = "```json\n[{\"id\": 12, \"nguoi\": \"@Minh\", \"viec\": \"Gửi báo giá đại lý XT\", \"han\": \"2026-10-16\"}, " +
    "{\"id\": 13, \"nguoi\": \"Lan\", \"viec\": \"Chốt công nợ\", \"han\": null}, {\"id\": 14, \"nguoi\": \"Hùng\", \"viec\": \"Gọi khách\", \"han\": \"null\"}]\n```";
  assert.deepEqual(parseExtractAnswer(answer), [
    { id: 12, person: "Minh", task: "Gửi báo giá đại lý XT", due: "2026-10-16" },
    { id: 13, person: "Lan", task: "Chốt công nợ", due: null },
    { id: 14, person: "Hùng", task: "Gọi khách", due: null },
  ]);
});

test("parseExtractAnswer: câu trả lời hỏng / thiếu id / việc quá ngắn thì bỏ, không ném lỗi", () => {
  assert.deepEqual(parseExtractAnswer("không có"), []);
  assert.deepEqual(parseExtractAnswer("[{\"id\": \"abc\", \"viec\": \"Gửi báo giá\"}]"), []);
  assert.deepEqual(parseExtractAnswer("[{\"id\": 5, \"viec\": \"x\"}]"), []);
  assert.deepEqual(parseExtractAnswer("[{\"id\": 5, \"viec\": \"Gửi"), []);
  assert.deepEqual(parseExtractAnswer("{\"id\": 5}"), []);
  assert.deepEqual(parseExtractAnswer("[null, 3, {\"id\": 6, \"viec\": \"Gọi lại khách\"}]"), [{ id: 6, person: "", task: "Gọi lại khách", due: null }]);
});
