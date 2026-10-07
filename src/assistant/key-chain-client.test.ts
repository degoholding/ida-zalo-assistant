import assert from "node:assert/strict";
import { test } from "node:test";
import { GeminiHttpError, WebSearchUnavailableError, type GeminiResult, type GenerateRequest, type ModelClient } from "./gemini-client.js";
import {
  ALL_KEYS_CAPPED_TEXT,
  HEAVY_MODEL_ALIAS,
  KEY_COOLDOWN_MS,
  KeyChainClient,
  KeyUsageLedger,
  classifyKeyError,
  vnDayKey,
  type ChainKey,
  type KeyProblem,
} from "./key-chain-client.js";
import { OpenAIHttpError } from "./openai-client.js";

const OK: GeminiResult = { content: { role: "model", parts: [{ text: "Dạ" }] }, inputTokens: 1, outputTokens: 1 };
const REQUEST: GenerateRequest = { system: "s", contents: [{ role: "user", parts: [{ text: "hi" }] }], tools: [] };

/** Khóa giả: `fail` = lỗi ném ra ở mọi lượt (null = trả lời được). Ghi lại mô hình được xin. */
function fakeKey(id: number, fail: unknown, extra: Partial<ChainKey> = {}, withSearch = false): ChainKey & { calls: (string | undefined)[] } {
  const calls: (string | undefined)[] = [];
  const client: ModelClient & { lastModel?: string } = {
    async generate(request) {
      calls.push(request.model);
      if (fail) throw fail;
      return OK;
    },
    async readDocument(_mime, _data, _instruction, model) {
      calls.push(model);
      if (fail) throw fail;
      return { text: "chữ", inputTokens: 1, outputTokens: 1 };
    },
    ...(withSearch ? {
      async searchWeb() {
        calls.push("search");
        if (fail) throw fail;
        return { text: "kết quả", sources: [], inputTokens: 1, outputTokens: 1 };
      },
    } : {}),
  };
  return { id, label: `số ${id}`, client, model: `model-${id}`, heavyModel: "", dailyCap: 0, calls, ...extra };
}

function recordingLedger() {
  const failures: { keyId: number; problem: KeyProblem }[] = [];
  const ledger = new KeyUsageLedger(() => undefined, (keyId, problem) => failures.push({ keyId, problem }));
  return { ledger, failures };
}

const NOW = Date.parse("2026-10-07T03:00:00Z"); // 10:00 giờ Việt Nam

const FAILURES: [string, unknown, KeyProblem["kind"]][] = [
  ["402 hết tiền", new OpenAIHttpError(402, "OpenAI 402: Payment Required"), "out_of_credit"],
  ["429 insufficient_quota của OpenAI là hết tiền, không phải hết hạn mức", new OpenAIHttpError(429, "OpenAI 429: You exceeded your current quota (insufficient_quota)"), "out_of_credit"],
  ["429 hết hạn mức", new GeminiHttpError(429, "Gemini x 429: RESOURCE_EXHAUSTED"), "rate_limited"],
  ["401 khóa sai", new OpenAIHttpError(401, "OpenAI 401: Incorrect API key provided: sk-***"), "bad_key"],
  ["403 hết quyền", new GeminiHttpError(403, "Gemini x 403: PERMISSION_DENIED"), "bad_key"],
  ["400 API key not valid của Gemini", new GeminiHttpError(400, "Gemini x 400: API key not valid. Please pass a valid API key."), "bad_key"],
  ["500 lỗi máy chủ", new OpenAIHttpError(500, "OpenAI 500: internal"), "overloaded"],
  ["503 quá tải", new GeminiHttpError(503, "Gemini x 503: overloaded"), "overloaded"],
  ["quá thời gian (Gemini fetch timeout)", Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "timeout"],
  ["quá thời gian (SDK OpenAI)", new OpenAIHttpError(0, "OpenAI lỗi mạng: Request timed out."), "timeout"],
  ["không gọi được (mạng)", new TypeError("fetch failed"), "unreachable"],
];

for (const [name, error, kind] of FAILURES) {
  test(`key chain: ${name} → switches to the next key silently and marks the failed key`, async () => {
    const first = fakeKey(1, error);
    const second = fakeKey(2, null);
    const { ledger, failures } = recordingLedger();
    const chain = new KeyChainClient([first, second], ledger, () => NOW);
    const result = await chain.generate(REQUEST);
    assert.equal(result.content.parts[0].text, "Dạ");
    assert.equal(first.calls.length, 1);
    assert.equal(second.calls.length, 1);
    assert.deepEqual(failures.map((item) => [item.keyId, item.problem.kind]), [[1, kind]]);
    assert.equal(chain.lastModel, "model-2");
    assert.equal(ledger.usedOn(2, NOW), 1, "lượt thành công đếm cho khóa đã trả lời");
    assert.equal(ledger.usedOn(1, NOW), 0, "lượt lỗi không đếm");
  });
}

test("key chain: tries keys strictly in order 1 → 2 → 3 and throws the last error when every key fails", async () => {
  const order: number[] = [];
  const keys = [1, 2, 3].map((id) => {
    const key = fakeKey(id, new OpenAIHttpError(500 + id, `lỗi ${id}`));
    const generate = key.client.generate.bind(key.client);
    key.client.generate = (request) => { order.push(id); return generate(request); };
    return key;
  });
  const { ledger, failures } = recordingLedger();
  await assert.rejects(new KeyChainClient(keys, ledger, () => NOW).generate(REQUEST), /lỗi 3/);
  assert.deepEqual(order, [1, 2, 3]);
  assert.deepEqual(failures.map((item) => item.problem.label), ["hãng quá tải (501)", "hãng quá tải (502)", "hãng quá tải (503)"]);
});

test("key chain: a failed key drops to the back of the line for 10 minutes, then key 1 is tried first again", async () => {
  let now = NOW;
  let broken = true;
  const first = fakeKey(1, null);
  first.client.generate = async (request) => {
    first.calls.push(request.model);
    if (broken) throw new OpenAIHttpError(402, "hết tiền");
    return OK;
  };
  const second = fakeKey(2, null);
  const { ledger } = recordingLedger();
  const chain = new KeyChainClient([first, second], ledger, () => now);
  await chain.generate(REQUEST);
  await chain.generate(REQUEST);
  assert.equal(first.calls.length, 1, "đang nghỉ thì không gọi lại khóa hết tiền");
  assert.equal(second.calls.length, 2);
  broken = false;
  now += KEY_COOLDOWN_MS + 1;
  await chain.generate(REQUEST);
  assert.equal(first.calls.length, 2, "hết giờ nghỉ thì khóa số 1 lại được thử trước");
  assert.equal(second.calls.length, 2);
});

test("key chain: a resting key is still tried as a last resort when every other key fails", async () => {
  const first = fakeKey(1, null);
  const second = fakeKey(2, new GeminiHttpError(503, "quá tải"));
  const { ledger } = recordingLedger();
  ledger.recordFailure(1, { kind: "rate_limited", label: "hết hạn mức (429)" }, NOW);
  const result = await new KeyChainClient([first, second], ledger, () => NOW).generate(REQUEST);
  assert.equal(result.content.parts[0].text, "Dạ");
  assert.deepEqual([first.calls.length, second.calls.length], [1, 1]);
});

test("daily cap counts per Vietnam day: 23:59 VN still today, 00:00 VN resets", async () => {
  // 16:59Z = 23:59 giờ Việt Nam ngày 07; 17:00Z = 00:00 ngày 08
  const lateNight = Date.parse("2026-10-07T16:59:00Z");
  const midnight = Date.parse("2026-10-07T17:00:00Z");
  assert.equal(vnDayKey(lateNight), "2026-10-07");
  assert.equal(vnDayKey(midnight), "2026-10-08");
  let now = lateNight;
  const first = fakeKey(1, null, { dailyCap: 2 });
  const second = fakeKey(2, null);
  const { ledger } = recordingLedger();
  ledger.seed(1, "2026-10-07", 1);
  const chain = new KeyChainClient([first, second], ledger, () => now);
  await chain.generate(REQUEST);
  assert.equal(first.calls.length, 1, "còn 1 lượt thì vẫn dùng khóa số 1");
  await chain.generate(REQUEST);
  assert.equal(first.calls.length, 1, "chạm trần 2 lượt thì nhảy sang khóa số 2");
  assert.equal(second.calls.length, 1);
  now = midnight;
  await chain.generate(REQUEST);
  assert.equal(first.calls.length, 2, "qua 0 giờ Việt Nam thì khóa số 1 được dùng lại");
});

test("daily cap: every key capped → clear error, no provider call", async () => {
  const only = fakeKey(1, null, { dailyCap: 1 });
  const { ledger } = recordingLedger();
  ledger.seed(1, vnDayKey(NOW), 1);
  await assert.rejects(new KeyChainClient([only], ledger, () => NOW).generate(REQUEST), new RegExp(ALL_KEYS_CAPPED_TEXT.slice(0, 20)));
  assert.equal(only.calls.length, 0);
});

test("daily cap 0 means unlimited, a negative cap from a hand-edited row is also unlimited", async () => {
  const key = fakeKey(1, null, { dailyCap: 0 });
  const { ledger } = recordingLedger();
  ledger.seed(1, vnDayKey(NOW), 1_000_000);
  await new KeyChainClient([key, fakeKey(2, null, { dailyCap: -5 })], ledger, () => NOW).generate(REQUEST);
  assert.equal(key.calls.length, 1);
});

test("heavy work uses each key's own heavy model, or its main model when none is set", async () => {
  const withHeavy = fakeKey(1, new OpenAIHttpError(429, "hết hạn mức"), { model: "deepseek-v4.1-flash", heavyModel: "deepseek-v4.1-pro" });
  const withoutHeavy = fakeKey(2, null, { model: "gemini-3.5-flash-lite", heavyModel: "" });
  const { ledger } = recordingLedger();
  const chain = new KeyChainClient([withHeavy, withoutHeavy], ledger, () => NOW);
  await chain.generate({ ...REQUEST, model: HEAVY_MODEL_ALIAS });
  assert.deepEqual(withHeavy.calls, ["deepseek-v4.1-pro"]);
  assert.deepEqual(withoutHeavy.calls, [undefined], "không khai bản nặng → client dùng mô hình chính của nó");
  await chain.readDocument("application/pdf", Buffer.from("x"), "đọc", HEAVY_MODEL_ALIAS);
  assert.deepEqual(withoutHeavy.calls, [undefined, undefined]);
  // Lượt thường không bao giờ gửi tên bí danh xuống hãng
  await chain.generate(REQUEST);
  assert.ok(![...withHeavy.calls, ...withoutHeavy.calls].includes(HEAVY_MODEL_ALIAS));
});

test("web search only goes to keys that can search; free-tier search refusal is not marked as a broken key", async () => {
  const openaiKey = fakeKey(1, null);
  const freeGemini = fakeKey(2, new WebSearchUnavailableError("hết hạn mức tìm web"), {}, true);
  const paidGemini = fakeKey(3, null, {}, true);
  const { ledger, failures } = recordingLedger();
  const chain = new KeyChainClient([openaiKey, freeGemini, paidGemini], ledger, () => NOW);
  const search = chain.searchWeb;
  assert.ok(search);
  const result = await search("giá lúa hôm nay");
  assert.equal(result.text, "kết quả");
  assert.deepEqual(failures, []);
  assert.equal(ledger.isCooling(2, NOW), false);
  assert.equal(new KeyChainClient([fakeKey(1, null)], ledger, () => NOW).searchWeb, undefined, "chuỗi không có Gemini thì không có tìm web");
});

test("classifyKeyError: unknown errors still have a short label, status shown when known", () => {
  assert.deepEqual(classifyKeyError(new OpenAIHttpError(404, "model not found")), { kind: "model_missing", label: "không có mô hình (404)" });
  assert.deepEqual(classifyKeyError(new Error("Gemini không trả lời (SAFETY)")), { kind: "other", label: "lỗi khác" });
  assert.deepEqual(classifyKeyError("chuỗi lạ"), { kind: "other", label: "lỗi khác" });
  assert.deepEqual(classifyKeyError(null), { kind: "other", label: "lỗi khác" });
});

test("KeyChainClient refuses an empty chain instead of silently answering nothing", () => {
  assert.throws(() => new KeyChainClient([], new KeyUsageLedger()));
});
