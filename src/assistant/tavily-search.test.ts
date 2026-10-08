import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSearchUnavailableError } from "./gemini-client.js";
import { createTavilySearch, formatTavilyResult } from "./tavily-search.js";

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("results become numbered sources with trimmed snippets the model can read and cite", () => {
  const result = formatTavilyResult({
    answer: "Giá vàng SJC hôm nay 128 triệu/lượng.",
    results: [
      { title: "Giá vàng 08/10", url: "https://a.vn/1", content: "x".repeat(2000), published_date: "2026-10-08T02:00:00Z" },
      { title: "", url: "", content: "bỏ — không có nguồn" },
      { title: "Tỷ giá", url: "https://b.vn/2", content: "USD  25.300\n\n đồng" },
    ],
  });
  assert.match(result.text, /^Tóm tắt nhanh: Giá vàng SJC/);
  assert.match(result.text, /\[1\] Giá vàng 08\/10 \(2026-10-08\) — https:\/\/a\.vn\/1/);
  assert.match(result.text, /\[2\] Tỷ giá — https:\/\/b\.vn\/2\nUSD 25\.300 đồng/);
  assert.ok(result.text.includes(`${"x".repeat(900)}…`));
  assert.deepEqual(result.sources, [{ title: "Giá vàng 08/10", url: "https://a.vn/1" }, { title: "Tỷ giá", url: "https://b.vn/2" }]);
});

test("an empty result is not an error", () => {
  assert.deepEqual(formatTavilyResult({}), { text: "", sources: [], inputTokens: 0, outputTokens: 0 });
});

test("the key goes in the Authorization header, never in the body; quota / bad key errors are «unavailable» so the caller can fall back", async () => {
  let seen: RequestInit | undefined;
  const ok = createTavilySearch("tvly-secret", async (_url, init) => { seen = init; return jsonResponse(200, { answer: "ok", results: [] }); });
  await ok("giá vàng hôm nay");
  assert.equal((seen?.headers as Record<string, string>).Authorization, "Bearer tvly-secret");
  assert.doesNotMatch(String(seen?.body), /tvly-secret/);
  for (const status of [401, 429, 432, 433]) {
    const search = createTavilySearch("k", async () => jsonResponse(status, { detail: { error: "limit" } }));
    await assert.rejects(search("q"), WebSearchUnavailableError);
  }
  const broken = createTavilySearch("k", async () => jsonResponse(500, {}));
  await assert.rejects(broken("q"), (error: unknown) => !(error instanceof WebSearchUnavailableError));
});
