import assert from "node:assert/strict";
import { test } from "node:test";
import { PermanentDownloadError, guardedDownload, type Fetcher } from "./guarded-download.js";

// Không mạng thật: giả `fetcher` và `lookup`. Bảng tên máy → địa chỉ để thử SSRF.
const HOSTS: Record<string, string[]> = { "cdn.test": ["93.184.216.34"], "internal.test": ["10.0.0.7"], "meta.test": ["169.254.169.254"] };
const lookup = async (host: string) => HOSTS[host] ?? [];
const signal = () => new AbortController().signal;

function streamOf(chunks: Uint8Array[], onPull?: () => void): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      onPull?.();
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
  }, { highWaterMark: 0 }); // 0: không kéo trước — chỉ pull khi có người đọc
}

test("tải bình thường từ CDN công khai", async () => {
  const fetcher: Fetcher = async () => new Response(Buffer.from("hello"), { headers: { "content-type": "image/png" } });
  const result = await guardedDownload("https://cdn.test/a.png", { fetcher, maxBytes: 100, signal: signal(), lookup });
  assert.equal(result.body.toString(), "hello");
  assert.equal(result.contentType, "image/png");
});

test("host phân giải ra IP nội bộ / IP literal nội bộ bị chặn, không gọi fetcher", async () => {
  let calls = 0;
  const fetcher: Fetcher = async () => { calls += 1; return new Response("x"); };
  for (const url of ["http://internal.test/x", "http://127.0.0.1:3306/", "http://169.254.169.254/latest/meta-data", "http://[64:ff9b::7f00:1]/", "file:///etc/passwd"]) {
    await assert.rejects(guardedDownload(url, { fetcher, maxBytes: 100, signal: signal(), lookup }), PermanentDownloadError, url);
  }
  assert.equal(calls, 0);
});

test("chuyển hướng sang 127.0.0.1 / metadata bị chặn ở bước đó; fetcher được gọi với redirect manual", async () => {
  const seen: string[] = [];
  for (const target of ["http://127.0.0.1/admin", "http://meta.test/latest", "http://[::ffff:7f00:1]/"]) {
    const fetcher: Fetcher = async (url, init) => {
      seen.push(`${url}|${init.redirect}`);
      return new Response(null, { status: 302, headers: { location: target } });
    };
    await assert.rejects(guardedDownload("https://cdn.test/a", { fetcher, maxBytes: 100, signal: signal(), lookup }), PermanentDownloadError, target);
  }
  assert.ok(seen.every((entry) => entry.endsWith("|manual")));
  assert.equal(seen.length, 3, "chỉ gọi đúng bước đầu, không theo tới đích nội bộ");
});

test("chuyển hướng hợp lệ được theo; quá 3 bước thì bỏ", async () => {
  const ok: Fetcher = async (url) => url.includes("/final")
    ? new Response("done") : new Response(null, { status: 301, headers: { location: "/final" } });
  assert.equal((await guardedDownload("https://cdn.test/a", { fetcher: ok, maxBytes: 100, signal: signal(), lookup })).body.toString(), "done");
  const loop: Fetcher = async () => new Response(null, { status: 302, headers: { location: "https://cdn.test/again" } });
  await assert.rejects(guardedDownload("https://cdn.test/a", { fetcher: loop, maxBytes: 100, signal: signal(), lookup }), /quá nhiều lần/);
});

test("thân vượt trần không có content-length: hủy luồng ngay, không đọc hết", async () => {
  let pulls = 0;
  const chunk = new Uint8Array(40);
  // Luồng vô hạn (40 byte mỗi lần) — mã cũ arrayBuffer() sẽ treo / cạn RAM
  const infinite = new ReadableStream<Uint8Array>({ pull(c) { pulls += 1; c.enqueue(chunk); } });
  const fetcher: Fetcher = async () => new Response(infinite);
  await assert.rejects(guardedDownload("https://cdn.test/big", { fetcher, maxBytes: 100, signal: signal(), lookup }), PermanentDownloadError);
  assert.ok(pulls <= 5, `đọc ${pulls} lần, phải dừng gần trần`);
});

test("content-length khai quá trần: báo ngay, không đọc thân", async () => {
  let pulled = false;
  const fetcher: Fetcher = async () => new Response(streamOf([new Uint8Array(1)], () => { pulled = true; }), { headers: { "content-length": "5000" } });
  await assert.rejects(guardedDownload("https://cdn.test/big", { fetcher, maxBytes: 100, signal: signal(), lookup }), PermanentDownloadError);
  assert.equal(pulled, false);
});

test("data URL (ảnh nhập từ Zalo Web) vẫn tải được, không cần tra DNS; data URL quá lớn bị từ chối", async () => {
  const fetcher: Fetcher = async (url) => fetch(url);
  const noDns = async () => { throw new Error("không được tra DNS cho data:"); };
  const url = `data:image/jpeg;base64,${Buffer.from("abc").toString("base64")}`;
  const result = await guardedDownload(url, { fetcher, maxBytes: 100, signal: signal(), lookup: noDns });
  assert.equal(result.body.toString(), "abc");
  assert.equal(result.contentType, "image/jpeg");
  await assert.rejects(guardedDownload(`data:text/plain;base64,${"A".repeat(5000)}`, { fetcher, maxBytes: 100, signal: signal(), lookup: noDns }), PermanentDownloadError);
});

test("HTTP 404 là lỗi vĩnh viễn, 500 là lỗi tạm", async () => {
  const gone: Fetcher = async () => new Response("", { status: 404 });
  await assert.rejects(guardedDownload("https://cdn.test/a", { fetcher: gone, maxBytes: 100, signal: signal(), lookup }), PermanentDownloadError);
  const boom: Fetcher = async () => new Response("", { status: 500 });
  await assert.rejects(guardedDownload("https://cdn.test/a", { fetcher: boom, maxBytes: 100, signal: signal(), lookup }),
    (e: Error) => !(e instanceof PermanentDownloadError) && /500/.test(e.message));
});
