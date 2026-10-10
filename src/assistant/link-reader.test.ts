import assert from "node:assert/strict";
import { test } from "node:test";
import { LinkReadError, htmlToText, isPrivateAddress, readLinkContent, resolveLinkTarget } from "./link-reader.js";
import { linkFingerprint } from "./read-link-tool.js";

test("resolveLinkTarget: link Google đổi sang đường xuất tệp", () => {
  assert.deepEqual(resolveLinkTarget("https://docs.google.com/spreadsheets/d/16Kf_RxhoeS8cwFZEm2HR5CPzJG_lXDNZJn0Dyy8929I/edit?usp=sharing"),
    { kind: "sheet", fetchUrl: "https://docs.google.com/spreadsheets/d/16Kf_RxhoeS8cwFZEm2HR5CPzJG_lXDNZJn0Dyy8929I/export?format=xlsx" });
  assert.equal(resolveLinkTarget("https://docs.google.com/document/d/abcdefghijkl/edit").fetchUrl, "https://docs.google.com/document/d/abcdefghijkl/export?format=txt");
  assert.equal(resolveLinkTarget("https://vnexpress.net/abc").kind, "page");
  assert.throws(() => resolveLinkTarget("file:///etc/passwd"), LinkReadError);
  assert.throws(() => resolveLinkTarget("không phải link"), LinkReadError);
});

// 10/10/2026: tệp Drive lớn qua uc?export=download trả trang cảnh báo virus thay vì tệp — usercontent + confirm=t tải thẳng
test("resolveLinkTarget: link Drive dùng đường usercontent kèm confirm=t (bỏ qua trang cảnh báo virus), giữ driveId để lùi khi lỗi mạng", () => {
  const target = resolveLinkTarget("https://drive.google.com/file/d/abcdefghijkl/view?usp=sharing");
  assert.equal(target.kind, "drive");
  assert.equal(target.fetchUrl, "https://drive.usercontent.google.com/download?id=abcdefghijkl&export=download&confirm=t");
  assert.equal(target.driveId, "abcdefghijkl");
});

test("isPrivateAddress: chặn địa chỉ nội bộ, cho địa chỉ công khai", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "142.250.66.78", "172.32.0.1", "2404:6800:4005::200e"]) assert.equal(isPrivateAddress(address), false, address);
});

test("readLinkContent: link trỏ vào máy nội bộ bị chặn trước khi gọi mạng", async () => {
  let called = false;
  const fetcher = (async () => { called = true; return new Response("x"); }) as typeof fetch;
  await assert.rejects(readLinkContent("http://127.0.0.1:3308/", undefined, {}, fetcher), LinkReadError);
  await assert.rejects(readLinkContent("http://localhost/", undefined, {}, fetcher), LinkReadError);
  assert.equal(called, false);
});

test("htmlToText: lấy tiêu đề + chữ, bỏ script / style", () => {
  assert.equal(htmlToText("<html><title>Tin</title><style>p{}</style><script>x()</script><p>Một &amp; hai</p><p>Ba</p></html>"), "# Tin\nMột & hai\nBa");
});

test("linkFingerprint: id tệp Google, hoặc máy + đường dẫn", () => {
  assert.equal(linkFingerprint("https://docs.google.com/spreadsheets/d/16Kf_RxhoeS8cwFZEm2HR5CPzJG_lXDNZJn0Dyy8929I/edit?usp=sharing"), "16Kf_RxhoeS8cwFZEm2HR5CPzJG_lXDNZJn0Dyy8929I");
  assert.equal(linkFingerprint("https://vnexpress.net/abc/?x=1"), "vnexpress.net/abc");
  assert.equal(linkFingerprint("rác"), null);
});

// --- Ghi âm từ link Drive (quick win phase 2) ---

function fakeReadDocument(text: string) {
  return async (mime: string, data: Buffer, instruction: string) => ({ text: `${mime}|${instruction.slice(0, 10)}|${text}`, inputTokens: 100, outputTokens: 20 });
}

test("readLinkContent: link Drive là ghi âm (content-type audio/mpeg) → readDocument với AUDIO_INSTRUCTION, cộng token", async () => {
  const fetcher = (async () => new Response("âm-thanh-giả", {
    status: 200, headers: { "content-type": "audio/mpeg", "content-disposition": 'attachment; filename="cuoc-hop.mp3"' },
  })) as typeof fetch;
  const result = await readLinkContent("https://drive.google.com/file/d/abcdefghijkl/view", fakeReadDocument("tóm tắt"), {}, fetcher);
  assert.equal(result.kind, "drive");
  assert.equal(result.how, "ghi âm .mp3 (mô hình nghe, gỡ băng + tóm tắt)");
  assert.match(result.text, /^audio\/mpeg\|/);
  assert.equal(result.inputTokens, 100);
  assert.equal(result.outputTokens, 20);
});

test("readLinkContent: Drive trả application/octet-stream — đoán ghi âm theo đuôi .m4a trong Content-Disposition", async () => {
  const fetcher = (async () => new Response("âm-thanh-giả", {
    status: 200, headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="cuoc-hop.m4a"' },
  })) as typeof fetch;
  const result = await readLinkContent("https://drive.google.com/file/d/abcdefghijkl/view", fakeReadDocument("x"), {}, fetcher);
  assert.equal(result.how, "ghi âm .m4a (mô hình nghe, gỡ băng + tóm tắt)");
});

// H3 (review 10/10/2026): không có readAudioSource (chỉ readDocument/Buffer, vd OpenAI) → trần THẤP hơn cấu hình chung
// (FALLBACK_AUDIO_MAX_BYTES = 25 MB) dù cài đặt cho phép 60 MB — tránh phình RAM ở app khi không streaming được.
test("readLinkContent: không có readAudioSource (fallback Buffer) → trần ghi âm hạ xuống 25 MB dù cấu hình 60 MB", async () => {
  let readDocumentCalled = false;
  const fetcher = (async () => new Response("x", {
    status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(30 * 1024 * 1024) },
  })) as typeof fetch;
  await assert.rejects(
    readLinkContent("https://drive.google.com/file/d/abcdefghijkl/view", async () => { readDocumentCalled = true; return { text: "", inputTokens: 0, outputTokens: 0 }; },
      { maxAudioBytes: 60 * 1024 * 1024 }, fetcher),
    (error: unknown) => {
      assert.ok(error instanceof LinkReadError);
      assert.match(error.message, /Ghi âm 30 MB, quá mức 25 MB bot được đọc/);
      return true;
    },
  );
  assert.equal(readDocumentCalled, false);
});

// H3: CÓ readAudioSource (Gemini, streaming) → giữ nguyên trần cấu hình (60 MB), không hạ xuống 25 MB như fallback
test("readLinkContent: có readAudioSource → giữ trần cấu hình đầy đủ, không bị hạ xuống mức fallback", async () => {
  const fetcher = (async () => new Response("x", {
    status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(30 * 1024 * 1024) },
  })) as typeof fetch;
  await assert.rejects(
    readLinkContent("https://drive.google.com/file/d/abcdefghijkl/view", undefined,
      { maxAudioBytes: 20 * 1024 * 1024, readAudioSource: async () => ({ text: "", inputTokens: 0, outputTokens: 0 }) }, fetcher),
    /Ghi âm 30 MB, quá mức 20 MB bot được đọc/,
  );
});

// H3: streaming thật — readAudioSource nhận luồng CHẢY THẲNG (source.open() trả ReadableStream), không phải Buffer đã đệm
test("readLinkContent: ghi âm qua readAudioSource CHẢY THẲNG (không đệm Buffer) — đúng mime / size / nội dung luồng", async () => {
  const bodyText = "âm-thanh-giả-streaming";
  const fetcher = (async () => new Response(bodyText, {
    status: 200,
    headers: {
      "content-type": "audio/mpeg", "content-disposition": 'attachment; filename="cuoc-hop.mp3"',
      "content-length": String(Buffer.byteLength(bodyText, "utf8")),
    },
  })) as typeof fetch;
  let seenSize = -1;
  let seenMime = "";
  const readAudioSource = async (source: { mime: string; size: number; displayName: string; open(): Promise<ReadableStream<Uint8Array>> }, instruction: string) => {
    seenMime = source.mime;
    seenSize = source.size;
    const stream = await source.open();
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
    return { text: `${text}|${instruction.slice(0, 4)}`, inputTokens: 50, outputTokens: 10 };
  };
  const result = await readLinkContent("https://drive.google.com/file/d/abcdefghijkl/view", undefined, { readAudioSource }, fetcher);
  assert.equal(seenMime, "audio/mpeg");
  assert.equal(seenSize, Buffer.byteLength(bodyText, "utf8"));
  assert.equal(result.text, `${bodyText}|Đây `);
  assert.equal(result.inputTokens, 50);
});

test("readLinkContent: đuôi ghi âm không nằm trong «Loại tệp bot được đọc» → từ chối như read_file", async () => {
  const fetcher = (async () => new Response("âm-thanh-giả", {
    status: 200, headers: { "content-type": "audio/mpeg", "content-disposition": 'attachment; filename="cuoc-hop.mp3"' },
  })) as typeof fetch;
  await assert.rejects(
    readLinkContent("https://drive.google.com/file/d/abcdefghijkl/view", fakeReadDocument("x"), { allowedExtensions: ["pdf", "docx"] }, fetcher),
    /Bot chưa được phép đọc tệp \.mp3/,
  );
});

test("readLinkContent: không có readDocument (bot chưa bật đọc tài liệu) → báo chưa bật nghe ghi âm", async () => {
  const fetcher = (async () => new Response("âm-thanh-giả", { status: 200, headers: { "content-type": "audio/mpeg" } })) as typeof fetch;
  await assert.rejects(readLinkContent("https://drive.google.com/file/d/abcdefghijkl/view", undefined, {}, fetcher), /Bot chưa bật nghe ghi âm/);
});

test("readLinkContent: readDocument ném lỗi thường (vd khóa chỉ OpenAI, ghi âm > 25 MB) → bọc thành LinkReadError giữ nguyên câu báo", async () => {
  const fetcher = (async () => new Response("âm-thanh-giả", { status: 200, headers: { "content-type": "audio/mpeg" } })) as typeof fetch;
  const throwing = async () => { throw new Error("Ghi âm 40 MB — OpenAI chỉ gỡ băng tệp tối đa 25 MB"); };
  await assert.rejects(readLinkContent("https://drive.google.com/file/d/abcdefghijkl/view", throwing, {}, fetcher), (error: unknown) => {
    assert.ok(error instanceof LinkReadError);
    assert.match(error.message, /OpenAI chỉ gỡ băng tệp tối đa 25 MB/);
    return true;
  });
});

test("readLinkContent: trang cảnh báo virus của Drive (tệp quá lớn chưa quét được) → câu báo riêng, không nhầm «chưa mở công khai»", async () => {
  const warningPage = '<html><title>Google Drive - Virus scan warning</title><body>can\'t scan this file for viruses</body></html>';
  const fetcher = (async () => new Response(warningPage, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as typeof fetch;
  await assert.rejects(readLinkContent("https://drive.google.com/file/d/abcdefghijkl/view", undefined, {}, fetcher), (error: unknown) => {
    assert.ok(error instanceof LinkReadError);
    assert.match(error.message, /quá lớn để tự quét virus/);
    assert.doesNotMatch(error.message, /chưa mở công khai/);
    return true;
  });
});

test("readLinkContent: tệp Drive chưa chia sẻ (trang đăng nhập HTML không phải cảnh báo virus) → câu báo chưa mở công khai như cũ", async () => {
  const fetcher = (async () => new Response("<html><body>Đăng nhập Google</body></html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as typeof fetch;
  await assert.rejects(readLinkContent("https://drive.google.com/file/d/abcdefghijkl/view", undefined, {}, fetcher), /chưa mở công khai/);
});

test("readLinkContent: đường usercontent lỗi mạng → lùi về đường uc?export=download cũ", async () => {
  const calledUrls: string[] = [];
  const fetcher = (async (input: string | URL) => {
    const url = String(input);
    calledUrls.push(url);
    if (url.includes("usercontent")) throw new Error("ECONNRESET");
    return new Response("âm-thanh-giả", { status: 200, headers: { "content-type": "audio/mpeg" } });
  }) as typeof fetch;
  const result = await readLinkContent("https://drive.google.com/file/d/abcdefghijkl/view", fakeReadDocument("x"), {}, fetcher);
  assert.equal(result.how, "ghi âm .mp3 (mô hình nghe, gỡ băng + tóm tắt)");
  assert.ok(calledUrls.some((url) => url.includes("usercontent")));
  assert.ok(calledUrls.some((url) => url.startsWith("https://drive.google.com/uc?export=download&id=abcdefghijkl")));
});

test("readLinkContent: video (content-type video/*) vẫn từ chối rõ ràng", async () => {
  const fetcher = (async () => new Response("x", { status: 200, headers: { "content-type": "video/mp4" } })) as typeof fetch;
  await assert.rejects(readLinkContent("https://vnexpress.net/clip.mp4", undefined, {}, fetcher), /Chưa đọc được loại nội dung/);
});
