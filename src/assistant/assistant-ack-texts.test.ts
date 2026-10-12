import assert from "node:assert/strict";
import { test } from "node:test";
import { ACK_TEXTS, isAckText } from "./assistant-ack-texts.js";

test("nhận ra đúng câu «chờ em xíu» (bỏ qua hoa thường, khoảng trắng) — sự cố prod 12/10/2026 lượt «okee»", () => {
  for (const text of ACK_TEXTS) assert.equal(isAckText(text), true, text);
  assert.equal(isAckText("  dạ em nhận được rồi,   chờ em một xíu nhé…  "), true);
});

test("câu trả lời thật mở đầu giống câu chờ không bị coi là câu chờ", () => {
  assert.equal(isAckText("Dạ em nhận được rồi, chờ em một xíu nhé… Đã gửi vào nhóm zalo bot."), false);
  assert.equal(isAckText("Dạ em nhận được rồi"), false);
  assert.equal(isAckText(""), false);
});
