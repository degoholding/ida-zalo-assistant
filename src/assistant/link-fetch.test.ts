import assert from "node:assert/strict";
import { test } from "node:test";
import { LinkReadError, fetchPublic, isPrivateAddress } from "./link-fetch.js";

const PAGE_LIMIT = { maxBytes: 20 * 1024 * 1024, isAudio: false };
const AUDIO_LIMIT = { maxBytes: 60 * 1024 * 1024, isAudio: true };

test("isPrivateAddress: chặn địa chỉ nội bộ, cho địa chỉ công khai", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "::1"]) assert.equal(isPrivateAddress(address), true, address);
  for (const address of ["8.8.8.8", "142.250.66.78"]) assert.equal(isPrivateAddress(address), false, address);
});

test("fetchPublic: Content-Length vượt trần theo pickLimit → báo lỗi ngay, đúng câu theo loại (trang thường / ghi âm)", async () => {
  const fetcher = (async () => new Response("x", { status: 200, headers: { "content-length": String(25 * 1024 * 1024) } })) as typeof fetch;
  await assert.rejects(fetchPublic("https://vnexpress.net/a.html", fetcher, () => PAGE_LIMIT), (error: unknown) => {
    assert.ok(error instanceof LinkReadError);
    assert.match(error.message, /Nội dung link quá lớn \(25 MB, trên 20 MB\)/);
    return true;
  });
  const audioFetcher = (async () => new Response("x", { status: 200, headers: { "content-length": String(85 * 1024 * 1024) } })) as typeof fetch;
  await assert.rejects(fetchPublic("https://drive.usercontent.google.com/download?id=x", audioFetcher, () => ({ maxBytes: 60 * 1024 * 1024, isAudio: true })),
    (error: unknown) => {
      assert.ok(error instanceof LinkReadError);
      assert.match(error.message, /Ghi âm 85 MB, quá mức 60 MB bot được đọc \(Cài đặt → Trợ lý → Cỡ tệp tối đa bot đọc\)/);
      return true;
    });
});

test("fetchPublic: không có Content-Length, thân tải vượt trần giữa chừng → báo lỗi, dừng tải", async () => {
  const big = "a".repeat(2 * 1024 * 1024);
  const fetcher = (async () => new Response(big, { status: 200 })) as typeof fetch;
  await assert.rejects(fetchPublic("https://vnexpress.net/a.html", fetcher, () => ({ maxBytes: 1024 * 1024, isAudio: false })), LinkReadError);
});

test("fetchPublic: octet-stream + tên tệp .m4a trong Content-Disposition → fileName để nơi gọi đoán loại âm thanh", async () => {
  const seen: { contentType: string; fileName: string }[] = [];
  const fetcher = (async () => new Response("du-lieu", {
    status: 200,
    headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="cuoc-hop.m4a"' },
  })) as typeof fetch;
  const result = await fetchPublic("https://drive.usercontent.google.com/download?id=x", fetcher, (contentType, fileName) => {
    seen.push({ contentType, fileName });
    return AUDIO_LIMIT;
  });
  assert.equal(result.fileName, "cuoc-hop.m4a");
  assert.equal(result.contentType, "application/octet-stream");
  assert.deepEqual(seen, [{ contentType: "application/octet-stream", fileName: "cuoc-hop.m4a" }]);
});

test("fetchPublic: trang cảnh báo virus của Drive (tệp quá lớn, chưa kèm confirm=t) → câu báo riêng, không lẫn với NOT_SHARED", async () => {
  const warningPage = '<html><title>Google Drive - Virus scan warning</title><body>Google Drive can\'t scan this file for viruses. ' +
    'Would you still like to download this file?</body></html>';
  const fetcher = (async () => new Response(warningPage, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as typeof fetch;
  await assert.rejects(fetchPublic("https://drive.usercontent.google.com/download?id=x&export=download", fetcher, () => AUDIO_LIMIT),
    (error: unknown) => {
      assert.ok(error instanceof LinkReadError);
      assert.match(error.message, /quá lớn để tự quét virus/);
      return true;
    });
});

// H3 (review 10/10/2026): isAudio + stream + Content-Length hợp lệ → trả luồng CHƯA đọc, không đệm Buffer
test("fetchPublic: isAudio + stream → trả FetchStreamResult (luồng thẳng), không đệm Buffer", async () => {
  const bodyText = "noi-dung-ghi-am";
  const fetcher = (async () => new Response(bodyText, {
    status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(Buffer.byteLength(bodyText, "utf8")) },
  })) as typeof fetch;
  const result = await fetchPublic("https://drive.usercontent.google.com/download?id=x", fetcher,
    () => ({ maxBytes: 60 * 1024 * 1024, isAudio: true, stream: true }));
  assert.ok("body" in result, "phải có trường body (FetchStreamResult)");
  if (!("body" in result)) throw new Error("unreachable");
  assert.equal(result.size, Buffer.byteLength(bodyText, "utf8"));
  const chunks: Uint8Array[] = [];
  for await (const chunk of result.body as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8"), bodyText);
});

// isAudio + stream nhưng Content-Length THIẾU (0) → không đủ an toàn để stream (Gemini cần size đúng), lùi về đệm Buffer
test("fetchPublic: isAudio + stream nhưng thiếu Content-Length → lùi về đệm Buffer như cũ", async () => {
  const fetcher = (async () => new Response("abc", { status: 200, headers: { "content-type": "audio/mpeg" } })) as typeof fetch;
  const result = await fetchPublic("https://drive.usercontent.google.com/download?id=x", fetcher,
    () => ({ maxBytes: 60 * 1024 * 1024, isAudio: true, stream: true }));
  assert.ok("data" in result, "không có Content-Length thì phải đệm Buffer (FetchResult)");
});

// Luồng CHẢY THẲNG vẫn phải tự chặn khi vượt trần giữa chừng dù Content-Length khai đúng (phòng máy chủ nói dối)
test("fetchPublic: luồng thẳng tự hủy nếu thân thật tải vượt quá maxBytes dù Content-Length khai nhỏ hơn", async () => {
  const big = "a".repeat(2 * 1024 * 1024);
  const fetcher = (async () => new Response(big, {
    status: 200, headers: { "content-type": "audio/mpeg", "content-length": "1" }, // khai dối 1 byte để qua kiểm declaredLength
  })) as typeof fetch;
  const result = await fetchPublic("https://drive.usercontent.google.com/download?id=x", fetcher,
    () => ({ maxBytes: 1024 * 1024, isAudio: true, stream: true }));
  if (!("body" in result)) throw new Error("phải là luồng thẳng");
  await assert.rejects(async () => {
    for await (const _chunk of result.body as unknown as AsyncIterable<Uint8Array>) { /* đọc hết để kích hoạt lỗi */ }
  }, LinkReadError);
});

test("fetchPublic: 404 trên máy google.com → câu rõ ràng; chuyển hướng tự theo dõi", async () => {
  let calls = 0;
  const fetcher = (async (url: string | URL) => {
    calls += 1;
    if (calls === 1) return new Response(null, { status: 303, headers: { location: "https://drive.usercontent.google.com/download?id=x" } });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  await assert.rejects(fetchPublic("https://drive.google.com/uc?export=download&id=x", fetcher, () => PAGE_LIMIT), /Không thấy tệp Google này/);
  assert.equal(calls, 2);
});
