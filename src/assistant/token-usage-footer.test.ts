import assert from "node:assert/strict";
import { test } from "node:test";
import { appendTokenFooter, formatTokenFooter, stripTokenFooter } from "./token-usage-footer.js";

const USAGE = { inputTokens: 7710, outputTokens: 1240, durationMs: 3420, model: "gemini-3.5-flash-lite" };

test("shows only the total tokens rounded to thousands", () => {
  assert.equal(formatTokenFooter(USAGE), "[9k token]"); // 7.710 + 1.240 = 8.950
  assert.equal(formatTokenFooter({ ...USAGE, inputTokens: 3192, outputTokens: 44 }), "[3k token]");
  assert.equal(formatTokenFooter({ ...USAGE, inputTokens: 1400, outputTokens: 99 }), "[1k token]");
  assert.equal(formatTokenFooter({ ...USAGE, inputTokens: 600, outputTokens: 50 }), "[<1k token]");
  assert.equal(formatTokenFooter({ ...USAGE, inputTokens: 0, outputTokens: 0 }), "[<1k token]");
});

test("the footer is removed again before the answer becomes history for the model", () => {
  const answer = "Dạ, nhóm K52 hôm nay xong tầng 6.";
  assert.equal(stripTokenFooter(appendTokenFooter(answer, USAGE)), answer);
  // Câu trả lời không có dòng đo token, hoặc có chữ [Token: ở giữa câu, thì giữ nguyên
  assert.equal(stripTokenFooter(answer), answer);
  // Dạng chi tiết cũ (tin đã gửi trước khi rút gọn) cũng được bỏ khỏi lịch sử
  assert.equal(stripTokenFooter(`${answer}\n\n[Token: 3.192 vào · 44 ra · 2,1 giây · gemini-3.5-flash-lite]`), answer);
  assert.equal(stripTokenFooter(`${answer}\n\n[<1k token]`), answer);
  assert.equal(stripTokenFooter("Mã [Token: abc] nằm giữa câu, không phải dòng cuối."), "Mã [Token: abc] nằm giữa câu, không phải dòng cuối.");
});
