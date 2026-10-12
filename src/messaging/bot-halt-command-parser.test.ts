import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBotHaltCommand } from "./bot-halt-command-parser.js";

test("câu tắt bot khớp trọn câu, có hoặc không dấu, hoa thường, dấu câu cuối", () => {
  for (const text of ["tắt bot", "Tắt bot khẩn", "tat bot", "dừng bot", "dừng gửi", "dừng gửi tin", "bot dừng lại", "stop bot", "/tatbot", "  TẮT BOT!  ", "tắt bot."]) {
    assert.equal(parseBotHaltCommand(text), "halt", text);
  }
});

test("câu bật bot và hỏi tình trạng", () => {
  for (const text of ["bật bot", "Bật lại bot", "mở bot", "bot chạy lại", "/batbot", "bat bot"]) assert.equal(parseBotHaltCommand(text), "resume", text);
  for (const text of ["tình trạng bot", "Trạng thái bot?", "tinh trang bot"]) assert.equal(parseBotHaltCommand(text), "status", text);
});

test("câu thường chứa chữ «tắt bot» KHÔNG phải lệnh", () => {
  for (const text of [
    "tắt bot đi em ơi rồi gửi báo cáo", "anh nhờ em tắt bot giúp", "đừng tắt bot nhé", "dừng gửi tin nhắn cho nhóm kho lúc 8h",
    "bật bot lên rồi báo cáo tuần cho anh nhé", "tình trạng bot của nhóm kho hôm nay thế nào", "gửi nhóm Kho: tắt bot", "", "   ", "bot",
  ]) {
    assert.equal(parseBotHaltCommand(text), null, text);
  }
});

test("câu quá 6 chữ không bao giờ là lệnh", () => {
  assert.equal(parseBotHaltCommand("tắt bot khẩn khẩn khẩn khẩn khẩn"), null);
});
