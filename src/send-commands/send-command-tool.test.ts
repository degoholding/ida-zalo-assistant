import assert from "node:assert/strict";
import { test } from "node:test";
import { runProposeSendTool } from "./send-command-tool.js";

// Các nhánh chặn của công cụ AI không cần DB: thiếu ngữ cảnh / không đủ quyền / thiếu tham số.

test("tool refuses without a send context", async () => {
  const outcome = await runProposeSendTool(undefined, { targets: ["Kho"], content: "hi" }, new Date());
  assert.match(String(outcome.response.error), /tin riêng/);
  assert.equal(outcome.fixedReply, undefined);
});

test("tool replaces the turn's reply when the asker may not issue send commands", async () => {
  const chat = { deps: {} as never, requester: null, uid: "u", name: "n", question: "q", sourceThreadId: 1 };
  const outcome = await runProposeSendTool(chat, { targets: ["Kho"], content: "hi" }, new Date());
  assert.match(outcome.fixedReply ?? "", /chỉ dành cho/);
});

test("tool rejects missing targets or content before touching the service", async () => {
  const chat = { deps: {} as never, requester: { uid: "u", name: "n", role: 1, recipientId: 1 }, uid: "u", name: "n", question: "q", sourceThreadId: 1 };
  assert.ok((await runProposeSendTool(chat, { targets: [], content: "hi" }, new Date())).response.error);
  assert.ok((await runProposeSendTool(chat, { targets: ["Kho"], content: " " }, new Date())).response.error);
});
