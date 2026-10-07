import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenAIClient, fromChatMessage, maskApiKeys, toChatMessages } from "./openai-client.js";
// SDK đọc thân phản hồi theo Content-Type — thiếu header thì coi là chữ thường
const JSON_HEADERS = { "Content-Type": "application/json" };
import { ModelRouterClient, looksLikeOpenAiKey, missingKeyProblem, primaryModels, resolveModelKeys, type ModelPlan } from "./model-router-client.js";

test("toChatMessages: lượt gọi hàm thành tool_calls, kết quả thành role tool đúng id và thứ tự", () => {
  const messages = toChatMessages("hệ thống", [
    { role: "user", parts: [{ text: "có bao nhiêu nhóm" }] },
    { role: "model", parts: [{ functionCall: { name: "list_groups", args: {} }, callId: "call_A" }, { functionCall: { name: "list_contacts", args: { kind: 1 } } }] },
    { role: "user", parts: [{ functionResponse: { name: "list_groups", response: { groups: 3 } } }, { functionResponse: { name: "list_contacts", response: { n: 9 } } }] },
  ]);
  assert.equal(messages[0].role, "system");
  assert.deepEqual(messages[2], {
    role: "assistant", content: null,
    tool_calls: [
      { id: "call_A", type: "function", function: { name: "list_groups", arguments: "{}" } },
      { id: "call_1_1", type: "function", function: { name: "list_contacts", arguments: '{"kind":1}' } },
    ],
  });
  assert.deepEqual(messages.slice(3), [
    { role: "tool", tool_call_id: "call_A", content: '{"groups":3}' },
    { role: "tool", tool_call_id: "call_1_1", content: '{"n":9}' },
  ]);
});

test("fromChatMessage: giữ id lệnh gọi, JSON tham số hỏng thì thành tham số rỗng", () => {
  const content = fromChatMessage({ content: null, tool_calls: [
    { id: "call_X", type: "function", function: { name: "read_link", arguments: '{"url":"https://a.vn"}' } },
    { id: "call_Y", type: "function", function: { name: "list_groups", arguments: "{hỏng" } },
  ] });
  assert.deepEqual(content.parts, [
    { functionCall: { name: "read_link", args: { url: "https://a.vn" } }, callId: "call_X" },
    { functionCall: { name: "list_groups", args: {} }, callId: "call_Y" },
  ]);
  assert.deepEqual(fromChatMessage({ content: "Chào anh" }).parts, [{ text: "Chào anh" }]);
});

test("OpenAIClient.generate: forceText gửi tool_choice none; quá tải thì chuyển mô hình dự phòng; khóa sai báo ngay", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    bodies.push(body);
    if (body.model === "gpt-busy") return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503, headers: JSON_HEADERS });
    if (body.model === "gpt-badkey") return new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), { status: 401, headers: JSON_HEADERS });
    return new Response(JSON.stringify({ choices: [{ message: { content: "Dạ" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { status: 200, headers: JSON_HEADERS });
  }) as typeof fetch;
  const client = new OpenAIClient("sk-test", "gpt-busy", ["gpt-ok"], fetcher);
  const tools = [{ name: "list_groups", description: "x", parameters: { type: "object", properties: {} } }];
  const result = await client.generate({ system: "s", contents: [{ role: "user", parts: [{ text: "hi" }] }], tools, forceText: true });
  assert.equal(result.content.parts[0].text, "Dạ");
  assert.equal(result.inputTokens, 10);
  assert.equal(client.lastModel, "gpt-ok");
  assert.equal(bodies[1].tool_choice, "none");
  await assert.rejects(new OpenAIClient("sk-bad", "gpt-badkey", ["gpt-ok"], fetcher).generate({ system: "s", contents: [], tools: [] }),
    (error: Error) => /401/.test(error.message) && !/sk-[A-Za-z0-9]/.test(error.message));
});

test("OpenAIClient gọi đúng địa chỉ API của bên bán lại khi được cấu hình", async () => {
  const urls: string[] = [];
  const fetcher = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: JSON_HEADERS });
  }) as typeof fetch;
  await new OpenAIClient("sk-x", "gpt-6", [], fetcher, "https://proxy.example.com/v1/").generate({ system: "s", contents: [], tools: [] });
  assert.deepEqual(urls, ["https://proxy.example.com/v1/chat/completions"]);
});

const PLAN = (provider: ModelPlan["provider"]): ModelPlan => ({
  provider,
  gemini: { model: "gemini-3.5-flash-lite", heavyModel: "gemini-3.5-flash", fallbackModels: [] },
  openai: { model: "gpt-6-luna", heavyModel: "gpt-6.1-sol", fallbackModels: [] },
});

test("định tuyến: khóa thiếu theo nhà cung cấp, bên chính, khóa OpenAI dán nhầm ô Gemini", () => {
  assert.equal(looksLikeOpenAiKey("sk-proj-abc"), true);
  assert.deepEqual(resolveModelKeys({ geminiKey: "sk-proj-abc", openaiKey: "" }), { geminiKey: "", openaiKey: "sk-proj-abc" });
  assert.deepEqual(resolveModelKeys({ geminiKey: "AIzaXYZ", openaiKey: "sk-1" }), { geminiKey: "AIzaXYZ", openaiKey: "sk-1" });
  assert.match(missingKeyProblem("openai", { geminiKey: "AIza", openaiKey: "" }) ?? "", /Khóa OpenAI/);
  assert.equal(missingKeyProblem("openai_then_gemini", { geminiKey: "AIza", openaiKey: "" }), null);
  assert.ok(missingKeyProblem("openai_then_gemini", { geminiKey: "", openaiKey: "" }));
  assert.equal(primaryModels(PLAN("openai_then_gemini"), { geminiKey: "AIza", openaiKey: "sk-1" }).model, "gpt-6-luna");
  // Ưu tiên OpenAI mà chưa có khóa OpenAI → Gemini là bên chính
  assert.equal(primaryModels(PLAN("openai_then_gemini"), { geminiKey: "AIza", openaiKey: "" }).model, "gemini-3.5-flash-lite");
});

test("ưu tiên OpenAI: OpenAI lỗi thì làm lại bằng Gemini (bản nặng ↔ bản nặng), rồi nghỉ OpenAI 10 phút", async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const href = String(url);
    calls.push(href.includes("openai.com") ? "openai" : href.match(/models\/([^:]+):/)?.[1] ?? href);
    if (href.includes("openai.com")) {
      return new Response(JSON.stringify({ error: { message: "Incorrect API key provided: sk-abc" } }), { status: 401, headers: JSON_HEADERS });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Dạ" }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } }),
      { status: 200, headers: JSON_HEADERS });
  }) as typeof fetch;
  try {
    let now = 0;
    const router = new ModelRouterClient({ geminiKey: "AIza", openaiKey: "sk-bad" }, PLAN("openai_then_gemini"), () => now);
    const request = { system: "s", contents: [{ role: "user" as const, parts: [{ text: "hi" }] }], tools: [] };
    const first = await router.generate({ ...request, model: "gpt-6.1-sol" });
    assert.equal(first.content.parts[0].text, "Dạ");
    assert.deepEqual(calls, ["openai", "gemini-3.5-flash"]);
    assert.equal(router.lastModel, "gemini-3.5-flash");
    calls.length = 0;
    await router.generate(request);
    assert.deepEqual(calls, ["gemini-3.5-flash-lite"], "trong 10 phút nghỉ không gọi lại OpenAI");
    now = 11 * 60 * 1000;
    calls.length = 0;
    await router.generate(request);
    assert.equal(calls[0], "openai", "hết giờ nghỉ thì thử lại OpenAI");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("chỉ OpenAI: OpenAI lỗi thì báo lỗi luôn, không có Gemini để lùi", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401, headers: JSON_HEADERS })) as typeof fetch;
  try {
    const router = new ModelRouterClient({ geminiKey: "AIza", openaiKey: "sk-bad" }, PLAN("openai"));
    await assert.rejects(router.generate({ system: "s", contents: [], tools: [] }), /401/);
    assert.equal(router.searchWeb, undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("maskApiKeys: che khóa trong câu báo lỗi trước khi ghi log", () => {
  assert.equal(maskApiKeys("401 Incorrect API key provided: sk-wZQ8G***********QLpb. See docs"), "401 Incorrect API key provided: sk-***. See docs");
  assert.equal(maskApiKeys("không có khóa"), "không có khóa");
});
