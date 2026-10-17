import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { AppConfig } from "../config.js";
import { fakeDb } from "../data-access/data-access-test-support.js";
import { createMcpGateway } from "./mcp-http-handler.js";

// Cổng thật (Host / Origin / Bearer) trên cổng mạng tạm; DB giả không có khóa nào ⇒ mọi khóa đều sai → 401.

const config = {
  mcp: { enabled: true, allowedHosts: ["127.0.0.1", "mcp.example.com"], rateLimitPerMinute: 60, maxConcurrentPerKey: 4, badKeyLimitPerMinute: 3 },
  privacy: { maskPersonalData: false },
} as unknown as AppConfig;

async function withGateway(run: (url: string) => Promise<void>): Promise<void> {
  const gateway = createMcpGateway(fakeDb().db, config);
  const server = http.createServer((request, response) => { gateway.handle(request, response, "198.51.100.7").catch(() => response.destroy()); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await gateway.close();
  }
}

const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
const post = (url: string, headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers } });

test("không có Authorization → 401 + WWW-Authenticate", async () => {
  await withGateway(async (url) => {
    const response = await post(url);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="bot-tro-ly"');
  });
});

test("khóa sai định dạng / không tồn tại → 401, không lộ khóa trong thân phản hồi", async () => {
  await withGateway(async (url) => {
    const response = await post(url, { Authorization: "Bearer idamcp_abcdefgh_secretsecretsecretsecretsecretsecretsecret" });
    assert.equal(response.status, 401);
    assert.ok(!(await response.text()).includes("secretsecret"));
  });
});

/** Gửi POST với tiêu đề Host tùy ý (fetch của Node không cho đè Host). */
function postWithHost(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request({ hostname: target.hostname, port: target.port, path: target.pathname, method: "POST", headers: { Host: host, "Content-Type": "application/json" } },
      (response) => { response.resume(); resolve(response.statusCode ?? 0); });
    request.on("error", reject);
    request.end(body);
  });
}

test("Host lạ → 403; Host trong danh sách (kể cả có cổng) qua được tới bước khóa (401); Origin lạ → 403", async () => {
  await withGateway(async (url) => {
    assert.equal(await postWithHost(url, "evil.example.org"), 403);
    assert.equal(await postWithHost(url, "mcp.example.com"), 401);
    assert.equal(await postWithHost(url, "127.0.0.1:8090"), 401);
    assert.equal((await post(url, { Origin: "https://evil.example.org" })).status, 403);
    assert.equal((await post(url, { Origin: "https://mcp.example.com" })).status, 401);
  });
});

test("sai khóa quá 3 lần mỗi phút từ cùng IP → 429 + Retry-After", async () => {
  await withGateway(async (url) => {
    for (let index = 0; index < 3; index++) assert.equal((await post(url, { Authorization: "Bearer nope" })).status, 401);
    const blocked = await post(url, { Authorization: "Bearer nope" });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "60");
  });
});
