import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMcpTurn } from "../assistant/mcp-bridge/assistant-mcp-turn.js";
import { withCommandSession } from "./send-command-session.js";

// Phiên lệnh chỉ dùng khi họ `send` bật VÀ máy chủ liệt kê đủ công cụ cần; mọi trường hợp khác trả null để nơi gọi chạy đường cũ (không bao giờ ném / chạy dở).

const fakeTurn = (families: string[], tools: string[], calls: string[] = []): AssistantMcpTurn => ({
  familyEnabled: (family: string) => families.includes(family),
  command: async () => ({ tools: [], instructions: "", toolNames: new Set(tools) }),
  callTool: async (_surface: string, name: string) => { calls.push(name); return { structuredContent: { ok: true } }; },
}) as unknown as AssistantMcpTurn;

test("không nguồn phiên → null (đường cũ)", async () => {
  assert.equal(await withCommandSession({}, ["send_context"], async () => 1), null);
});

test("nguồn trả undefined, họ send tắt, hoặc thiếu công cụ → null, chưa chạy gì", async () => {
  let ran = false;
  const run = async () => { ran = true; return 1; };
  assert.equal(await withCommandSession({ mcp: async () => undefined }, ["send_context"], run), null);
  assert.equal(await withCommandSession({ mcp: async () => fakeTurn(["tickets"], ["send_context"]) }, ["send_context"], run), null);
  assert.equal(await withCommandSession({ mcp: async () => fakeTurn(["send"], ["send_context"]) }, ["send_context", "send_draft_create"], run), null);
  assert.equal(ran, false);
});

test("đủ điều kiện → chạy qua tools/call mặt lệnh và trả kết quả có cấu trúc; lỗi công cụ ném (không lùi đường cũ giữa chừng)", async () => {
  const calls: string[] = [];
  const turn = fakeTurn(["send"], ["send_context"], calls);
  const done = await withCommandSession({ mcp: async () => turn }, ["send_context"], (call) => call("send_context", {}));
  assert.deepEqual(done, { value: { ok: true } });
  assert.deepEqual(calls, ["send_context"]);
  const broken = { ...turn, callTool: async () => ({ isError: true, _meta: { "bot-tro-ly/error": { message: "hỏng" } } }) } as unknown as AssistantMcpTurn;
  await assert.rejects(withCommandSession({ mcp: async () => broken }, ["send_context"], (call) => call("send_context", {})), /hỏng/);
});
