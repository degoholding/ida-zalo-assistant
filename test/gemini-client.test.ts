import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GeminiClient, type GeminiContent } from "../src/assistant/gemini-client.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function okBody(text: string) {
  return { candidates: [{ content: { role: "model", parts: [{ text }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2 } };
}

function stubFetch(script: { model: string; status: number }[]) {
  const calls: { model: string; body: { contents: GeminiContent[] } }[] = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const model = decodeURIComponent(/models\/([^:]+):/.exec(url)![1]);
    calls.push({ model, body: JSON.parse(init.body) });
    const next = script.shift()!;
    assert.equal(next.model, model, "gọi sai mô hình");
    const body = next.status === 200 ? okBody(`trả lời từ ${model}`) : { error: { code: next.status, message: "quá tải" } };
    return new Response(JSON.stringify(body), { status: next.status });
  }) as unknown as typeof fetch;
  return calls;
}

const request = {
  system: "s",
  tools: [],
  contents: [
    { role: "user" as const, parts: [{ text: "hỏi" }] },
    { role: "model" as const, parts: [{ functionCall: { name: "list_groups", args: {} }, thoughtSignature: "chu-ky-cua-model-chinh" }] },
  ],
};

test("503 thì thử lại cùng mô hình; được thì không đổi mô hình", async () => {
  const calls = stubFetch([{ model: "chinh", status: 503 }, { model: "chinh", status: 200 }]);
  const client = new GeminiClient("k", "chinh", ["du-phong"], async () => undefined);
  const result = await client.generate(request);
  assert.equal(result.content.parts[0].text, "trả lời từ chinh");
  assert.equal(result.outputTokens, 7); // token suy nghĩ tính vào đầu ra
  assert.equal(calls.length, 2);
  assert.equal(client.lastModel, "chinh");
});

test("mô hình chính 503 mãi thì chuyển sang dự phòng", async () => {
  const calls = stubFetch([
    { model: "chinh", status: 503 }, { model: "chinh", status: 503 },
    { model: "du-phong", status: 200 },
  ]);
  const client = new GeminiClient("k", "chinh", ["du-phong"], async () => undefined);
  const result = await client.generate(request);
  assert.equal(result.content.parts[0].text, "trả lời từ du-phong");
  assert.equal(client.lastModel, "du-phong");
  assert.equal(calls.length, 3);
});

test("lượt gọi hàm của MÔ HÌNH KHÁC được viết lại thành chữ thường (kèm kết quả hàm)", async () => {
  // Lượt 1: mô hình chính gọi hàm; lượt 2: mô hình chính quá tải → dự phòng phải đọc lịch sử đó
  const calls = stubFetch([{ model: "chinh", status: 200 }]);
  const client = new GeminiClient("k", "chinh", ["du-phong"], async () => undefined);
  const first = await client.generate({ system: "s", tools: [], contents: [{ role: "user", parts: [{ text: "hỏi" }] }] });
  first.content.parts = [{ functionCall: { name: "find_people", args: { name: "Bình" } }, thoughtSignature: "ky" }];
  const history: GeminiContent[] = [
    { role: "user", parts: [{ text: "hỏi" }] },
    first.content,
    { role: "user", parts: [{ functionResponse: { name: "find_people", response: { people: [{ uid: "u1" }] } } }] },
  ];
  calls.length = 0;
  const more = stubFetch([{ model: "chinh", status: 503 }, { model: "chinh", status: 503 },
    { model: "du-phong", status: 200 }]);
  await client.generate({ system: "s", tools: [], contents: history });
  // Mô hình chính vẫn nhận nguyên lượt gọi hàm (có chữ ký) của chính nó
  assert.ok(more[0].body.contents[1].parts[0].functionCall);
  // Mô hình dự phòng nhận chữ thường, không còn functionCall / functionResponse
  const fallbackContents = more[2].body.contents;
  assert.match(fallbackContents[1].parts[0].text!, /Đã gọi công cụ find_people/);
  assert.match(fallbackContents[2].parts[0].text!, /Kết quả công cụ find_people: .*u1/);
  assert.equal(JSON.stringify(fallbackContents).includes("functionCall"), false);
});

test("lỗi không tạm thời (400) thì báo ngay, không thử lại, không đổi mô hình", async () => {
  const calls = stubFetch([{ model: "chinh", status: 400 }]);
  const client = new GeminiClient("k", "chinh", ["du-phong"], async () => undefined);
  await assert.rejects(client.generate(request), /400/);
  assert.equal(calls.length, 1);
});

test("mô hình dự phòng đã bị khai tử (404) thì bỏ qua, sang mô hình kế tiếp", async () => {
  const calls = stubFetch([
    { model: "chinh", status: 503 }, { model: "chinh", status: 503 },
    { model: "da-khai-tu", status: 404 },
    { model: "con-song", status: 200 },
  ]);
  const client = new GeminiClient("k", "chinh", ["da-khai-tu", "con-song"], async () => undefined);
  const result = await client.generate(request);
  assert.equal(result.content.parts[0].text, "trả lời từ con-song");
  assert.equal(calls.length, 4);
});

test("dự phòng vừa chạy được thì 10 phút sau đi thẳng sang nó; hết 10 phút thì thử lại mô hình chính", async () => {
  let now = 0;
  const client = new GeminiClient("k", "chinh", ["du-phong"], async () => undefined, () => now);
  stubFetch([{ model: "chinh", status: 503 }, { model: "chinh", status: 503 }, { model: "du-phong", status: 200 }]);
  await client.generate(request);
  now = 5 * 60 * 1000;
  const second = stubFetch([{ model: "du-phong", status: 200 }]);
  await client.generate(request);
  assert.equal(second.length, 1);
  now = 11 * 60 * 1000;
  const third = stubFetch([{ model: "chinh", status: 200 }]);
  await client.generate(request);
  assert.equal(third[0].model, "chinh");
});

// Gặp 06/10/2026: vòng cuối chỉ bỏ danh sách công cụ thì Gemini vẫn trả lệnh gọi → «Quá số vòng gọi công cụ».
// Vòng cuối phải gửi kèm công cụ + functionCallingConfig NONE để mô hình buộc trả lời bằng chữ.
test("forceText sends the tools with function calling disabled; normal turns leave tool choice to the model", async () => {
  const tools = [{ name: "list_groups", description: "d", parameters: { type: "object", properties: {} } }];
  const calls = stubFetch([{ model: "chinh", status: 200 }, { model: "chinh", status: 200 }]);
  const client = new GeminiClient("k", "chinh", [], async () => undefined);
  await client.generate({ ...request, tools, forceText: true });
  await client.generate({ ...request, tools });
  const [forced, normal] = calls.map((call) => call.body as unknown as { tools?: unknown[]; toolConfig?: unknown });
  assert.deepEqual(forced.toolConfig, { functionCallingConfig: { mode: "NONE" } });
  assert.equal(forced.tools?.length, 1);
  assert.equal(normal.toolConfig, undefined);
});
