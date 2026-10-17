import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { serveSpa } from "./spa-static.js";

// Dựng thư mục build giả + máy chủ thật để kiểm đường đi qua `serveSpa` (không cần DB).
let distDir = "";
let server: http.Server;
let baseUrl = "";

before(async () => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), "spa-static-"));
  fs.writeFileSync(path.join(distDir, "index.html"), "<!doctype html><p>trang chính</p>");
  server = http.createServer((request, response) => {
    if (!serveSpa(distDir, request.url ?? "/", response)) {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(distDir, { recursive: true, force: true });
});

test("đường có mã % hỏng không làm sập máy chủ — trả index.html", async () => {
  const response = await fetch(`${baseUrl}/app/%E0%A4%A`, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /trang chính/);
});

test("đường lạ trong /app trả index.html cho router phía trình duyệt", async () => {
  const response = await fetch(`${baseUrl}/app/conversations/12`, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-cache");
  assert.match(await response.text(), /trang chính/);
});
