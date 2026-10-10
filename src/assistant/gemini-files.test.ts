import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadGeminiFile, uploadGeminiFileStream } from "./gemini-files.js";

// Phase 4: `uploadGeminiFileStream` dùng cho ghi âm cuộc họp chảy thẳng từ Drive (không đệm RAM). Bài kiểm giả lập
// `fetch` để kiểm đúng giao thức resumable (start → upload,finalize → poll ACTIVE), KHÔNG gọi mạng thật.

function fakeStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

/** `fetcher` giả: ghi lại mọi lời gọi, trả lời theo kịch bản `responses` (một cho mỗi lần gọi, theo thứ tự). */
function fakeFetcher(responses: { status?: number; headers?: Record<string, string>; json?: unknown }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      headers: { get: (name: string) => next.headers?.[name.toLowerCase()] ?? null },
      json: async () => next.json ?? {},
    } as unknown as Response;
  }) as typeof fetch;
  return { fetcher, calls };
}

test("uploadGeminiFileStream: mở phiên resumable kèm Content-Length đúng `size` tham số (không phải size của luồng đã đọc)", async () => {
  const { fetcher, calls } = fakeFetcher([
    { headers: { "x-goog-upload-url": "https://upload.example/u1" } },
    { json: { file: { name: "files/abc", uri: "https://files/abc", state: "ACTIVE" } } },
  ]);
  const file = await uploadGeminiFileStream("key-1", "audio/mpeg", 60_000_000, fakeStream(), "cuoc-hop.mp3", fetcher);
  assert.deepEqual(file, { name: "files/abc", uri: "https://files/abc" });
  assert.equal(calls.length, 2);
  assert.equal((calls[0].init?.headers as Record<string, string>)["X-Goog-Upload-Header-Content-Length"], "60000000");
  assert.equal((calls[1].init?.headers as Record<string, string>)["Content-Length"], "60000000");
  assert.ok(calls[1].init?.body, "phải gửi kèm thân luồng");
  assert.equal((calls[1].init as unknown as { duplex?: string }).duplex, "half", "Node fetch đòi duplex: half khi thân là luồng");
});

test("uploadGeminiFileStream: tệp PROCESSING thì chờ rồi mới trả về (poll tới khi ACTIVE)", async () => {
  const { fetcher } = fakeFetcher([
    { headers: { "x-goog-upload-url": "https://upload.example/u1" } },
    { json: { file: { name: "files/abc", uri: "https://files/abc", state: "PROCESSING" } } },
    { json: { state: "ACTIVE" } },
  ]);
  const file = await uploadGeminiFileStream("key-1", "audio/mpeg", 1000, fakeStream(), "x.mp3", fetcher);
  assert.equal(file.uri, "https://files/abc");
});

test("uploadGeminiFileStream: phiên mở lỗi (không có upload-url) thì ném lỗi rõ ràng", async () => {
  const { fetcher } = fakeFetcher([{ status: 403 }]);
  await assert.rejects(uploadGeminiFileStream("key-1", "audio/mpeg", 1000, fakeStream(), "x.mp3", fetcher), /không mở được phiên tải/);
});

// L2 (review 10/10/2026): waitActive hỏng (FAILED / quá hạn) SAU KHI tệp đã tải lên xong — phải xóa ngay, không chờ
// Google tự dọn 48h.
test("uploadGeminiFileStream: waitActive trả FAILED → xóa tệp vừa tải (L2), vẫn ném lỗi như cũ", async () => {
  const { fetcher, calls } = fakeFetcher([
    { headers: { "x-goog-upload-url": "https://upload.example/u1" } },
    { json: { file: { name: "files/orphan", uri: "https://files/orphan", state: "FAILED" } } },
  ]);
  await assert.rejects(uploadGeminiFileStream("key-1", "audio/mpeg", 1000, fakeStream(), "x.mp3", fetcher), /không sẵn sàng/);
  const deleteCall = calls.find((call) => call.url.includes("files/orphan"));
  assert.ok(deleteCall, "phải gọi xóa tệp files/orphan");
  assert.equal(deleteCall?.init?.method, "DELETE");
});

test("uploadGeminiFile (Buffer) vẫn hoạt động như cũ sau khi tách startUpload / waitActive dùng chung", async () => {
  const { fetcher, calls } = fakeFetcher([
    { headers: { "x-goog-upload-url": "https://upload.example/u1" } },
    { json: { file: { name: "files/xyz", uri: "https://files/xyz", state: "ACTIVE" } } },
  ]);
  const data = Buffer.from("nội dung giả");
  const file = await uploadGeminiFile("key-1", "application/pdf", data, "tai-lieu.pdf", fetcher);
  assert.deepEqual(file, { name: "files/xyz", uri: "https://files/xyz" });
  assert.equal((calls[1].init?.headers as Record<string, string>)["Content-Length"], String(data.length));
});
