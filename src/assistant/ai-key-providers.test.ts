import assert from "node:assert/strict";
import { test } from "node:test";
import { AiKeyProvider } from "../constants.js";
import { AiKeyCheckError, assertPublicStation, normalizeBaseUrl, probeAiKey, type ProbeInput } from "./ai-key-providers.js";

const KEY = "sk-live-0123456789abcdefWXYZ";

test("normalizeBaseUrl accepts a public https station and trims the trailing slash", () => {
  assert.equal(normalizeBaseUrl("  https://modelapi.vn/v1/  "), "https://modelapi.vn/v1");
  assert.equal(normalizeBaseUrl("https://API.Example.com/openai/v1"), "https://api.example.com/openai/v1");
});

const BLOCKED_STATIONS = [
  "http://modelapi.vn/v1", // khóa đi trên đường truyền không mã hóa
  "https://localhost/v1",
  "https://localhost:8090/v1",
  "https://127.0.0.1/v1",
  "https://10.0.0.5/v1",
  "https://172.16.3.4/v1",
  "https://192.168.1.10/v1",
  "https://169.254.169.254/latest", // máy chủ siêu dữ liệu đám mây
  "https://100.64.0.1/v1",
  "https://0.0.0.0/v1",
  "https://[::1]/v1",
  "https://[fd00::1]/v1",
  "https://[::ffff:127.0.0.1]/v1",
  "https://mysql/v1", // tên máy trong mạng docker, không có dấu chấm
  "https://printer.local/v1",
  "https://api.internal/v1",
  "https://user:pass@modelapi.vn/v1",
  "https://modelapi.vn/v1?redirect=http://10.0.0.1",
  "ftp://modelapi.vn/v1",
  "modelapi.vn/v1",
  "",
  "javascript:alert(1)",
];

for (const station of BLOCKED_STATIONS) {
  test(`normalizeBaseUrl blocks «${station}»`, () => {
    assert.throws(() => normalizeBaseUrl(station), AiKeyCheckError);
  });
}

test("assertPublicStation blocks a public-looking domain that resolves to an internal IP, and an unknown domain", async () => {
  await assert.rejects(assertPublicStation("https://evil.example.com/v1", async () => ["93.184.216.34", "10.1.2.3"]), /mạng nội bộ/);
  await assert.rejects(assertPublicStation("https://khong-ton-tai.example/v1", async () => { throw new Error("ENOTFOUND"); }), /Không tìm thấy máy chủ/);
  await assertPublicStation("https://modelapi.vn/v1", async () => ["103.1.2.3"]);
});

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as typeof fetch;
  return { fetcher, calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const CUSTOM: ProbeInput = { provider: AiKeyProvider.OpenAICompatible, key: KEY, baseUrl: "https://modelapi.vn/v1", model: "" };

test("probe: each provider is checked at its standard address with a no-token call, key in the header not the URL", async () => {
  const cases: [AiKeyProvider, string][] = [
    [AiKeyProvider.Gemini, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=50"],
    [AiKeyProvider.OpenAI, "https://api.openai.com/v1/models"],
    [AiKeyProvider.DeepSeek, "https://api.deepseek.com/v1/models"],
    [AiKeyProvider.Xai, "https://api.x.ai/v1/models"],
    [AiKeyProvider.OpenRouter, "https://openrouter.ai/api/v1/key"],
  ];
  for (const [provider, expected] of cases) {
    const { fetcher, calls } = fakeFetch(() => json(200, { data: [{ id: "m-1" }] }));
    await probeAiKey({ provider, key: KEY, baseUrl: "", model: "" }, fetcher);
    assert.equal(calls[0].url, expected);
    assert.ok(!calls[0].url.includes(KEY));
    assert.equal(calls[0].init.redirect, "manual", "không tự đi theo chuyển hướng (có thể trỏ vào mạng nội bộ)");
  }
});

const REJECTIONS: [string, () => Response, RegExp][] = [
  ["401 → wrong key", () => json(401, { error: { message: `Incorrect API key provided: ${KEY}` } }), /không nhận khóa này/],
  ["403 → wrong key", () => json(403, { error: { message: "forbidden" } }), /không nhận khóa này/],
  ["402 → out of credit", () => json(402, { error: { message: "Payment Required" } }), /hết tiền/],
  ["insufficient_quota → out of credit", () => json(400, { error: { code: "insufficient_quota" } }), /hết tiền/],
  ["404 → wrong station address", () => json(404, { error: "not found" }), /Không thấy API ở địa chỉ trạm/],
  ["HTML page with 200 → not an OpenAI API", () => new Response("<html><body>Trang chủ</body></html>", { status: 200 }), /nhận được trang web/],
  ["302 → redirect refused", () => new Response(null, { status: 302, headers: { location: "http://10.0.0.1/" } }), /chuyển hướng/],
  ["502 → provider down", () => json(502, {}), /đang lỗi \(502\)/],
  ["418 → generic", () => json(418, {}), /trả lỗi 418/],
];

for (const [name, respond, message] of REJECTIONS) {
  test(`probe rejects with a Vietnamese message: ${name}; the key never appears in the message`, async () => {
    const { fetcher } = fakeFetch(respond);
    await assert.rejects(probeAiKey(CUSTOM, fetcher), (error: Error) => {
      assert.ok(error instanceof AiKeyCheckError);
      assert.match(error.message, message);
      assert.ok(!error.message.includes(KEY));
      return true;
    });
  });
}

test("probe: Gemini rejects a bad key with 400 «API key not valid»", async () => {
  const { fetcher } = fakeFetch(() => json(400, { error: { message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }));
  await assert.rejects(probeAiKey({ provider: AiKeyProvider.Gemini, key: "AIzaSyFAKEFAKEFAKE", baseUrl: "", model: "" }, fetcher), /Gemini không nhận khóa này/);
});

test("probe: timeout and network failure become plain Vietnamese sentences", async () => {
  const timeout = fakeFetch(() => { throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); });
  await assert.rejects(probeAiKey(CUSTOM, timeout.fetcher), /không trả lời sau 15 giây/);
  const down = fakeFetch(() => { throw new TypeError("fetch failed"); });
  await assert.rejects(probeAiKey(CUSTOM, down.fetcher), /Không gọi được Trạm modelapi\.vn/);
});

test("probe: 429 means the key is valid but rate limited — saved with a note", async () => {
  const { fetcher } = fakeFetch(() => json(429, { error: { message: "rate limit" } }));
  const result = await probeAiKey({ ...CUSTOM, provider: AiKeyProvider.OpenAI }, fetcher);
  assert.match(result.note, /hết hạn mức/);
});

test("probe: lists models and warns when the chosen model is not listed", async () => {
  const { fetcher } = fakeFetch(() => json(200, { data: [{ id: "deepseek-v4.1-flash" }, { id: "gpt-6-luna" }] }));
  const listed = await probeAiKey({ ...CUSTOM, model: "deepseek-v4.1-flash" }, fetcher);
  assert.deepEqual(listed.models, ["deepseek-v4.1-flash", "gpt-6-luna"]);
  assert.equal(listed.note, "");
  const missing = await probeAiKey({ ...CUSTOM, model: "go-tay-sai" }, fetcher);
  assert.match(missing.note, /không liệt kê mô hình «go-tay-sai»/);
});

test("probe: a custom station without /models falls back to a 1-token chat when a model is chosen", async () => {
  const { fetcher, calls } = fakeFetch((url) => (url.endsWith("/models") ? json(404, {}) : json(200, { choices: [{ message: { content: "p" } }] })));
  await probeAiKey({ ...CUSTOM, model: "deepseek-v4.1-flash" }, fetcher);
  assert.equal(calls[1].url, "https://modelapi.vn/v1/chat/completions");
  const body = JSON.parse(String(calls[1].init.body)) as { max_tokens: number; model: string };
  assert.equal(body.max_tokens, 1);
  assert.equal(body.model, "deepseek-v4.1-flash");
});

test("isPrivateAddress also catches IPv4-mapped IPv6 in the hex form the URL parser produces", async () => {
  const { isPrivateAddress } = await import("./link-reader.js");
  assert.equal(new URL("https://[::ffff:127.0.0.1]/").hostname, "[::ffff:7f00:1]");
  assert.equal(isPrivateAddress("::ffff:7f00:1"), true);
  assert.equal(isPrivateAddress("::ffff:a00:5"), true); // 10.0.0.5
  assert.equal(isPrivateAddress("::ffff:5db8:d822"), false); // 93.184.216.34
});
