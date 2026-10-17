import assert from "node:assert/strict";
import { test } from "node:test";
import { AttachmentStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { FileStorage } from "../storage/file-storage.js";
import { AttachmentDownloader, requestAndAwaitDownload, resolveExtension, sanitizeFileName, type DownloadEnqueuer } from "./attachment-downloader.js";

// requestAndAwaitDownload (phase 6, 10/10/2026): trợ lý chủ động đọc một tệp Skip/Failed/Pending còn link Zalo — đưa
// về Pending + xếp hàng tải + CHỜ tới khi Stored / Failed / hết thời gian. Giả `db.query` thay vì dựng MySQL thật (hàm
// chỉ cần hai câu lệnh: UPDATE đưa về Pending, SELECT status lặp lại) + giả `downloader` (chỉ cần `enqueue`).

function fakeDb(statusSequence: number[]): { db: Db; updates: unknown[][] } {
  const updates: unknown[][] = [];
  let call = 0;
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("UPDATE")) {
        updates.push(params ?? []);
        return [{ affectedRows: 1 }];
      }
      // SELECT status — mỗi lần gọi trả giá trị kế trong kịch bản, giữ nguyên giá trị cuối nếu gọi nhiều hơn kịch bản
      const status = statusSequence[Math.min(call, statusSequence.length - 1)];
      call += 1;
      return [[{ status }]];
    },
  } as unknown as Db;
  return { db, updates };
}

test("requestAndAwaitDownload: Stored ngay lần hỏi đầu → trả 'stored', có đưa về Pending + xếp hàng trước đó", async () => {
  const { db, updates } = fakeDb([AttachmentStatus.Stored]);
  const enqueued: number[] = [];
  const downloader: DownloadEnqueuer = { enqueue: (id) => enqueued.push(id) };
  const outcome = await requestAndAwaitDownload(db, downloader, 42, 5, 50);
  assert.equal(outcome, "stored");
  assert.deepEqual(enqueued, [42]);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], [AttachmentStatus.Pending, 42, AttachmentStatus.Failed, AttachmentStatus.Skipped]);
});

test("requestAndAwaitDownload: còn Pending vài lần rồi Stored → vẫn trả 'stored' (không cắt ngang khi còn hạn)", async () => {
  const { db } = fakeDb([AttachmentStatus.Pending, AttachmentStatus.Pending, AttachmentStatus.Stored]);
  const downloader: DownloadEnqueuer = { enqueue: () => {} };
  assert.equal(await requestAndAwaitDownload(db, downloader, 1, 5, 200), "stored");
});

test("requestAndAwaitDownload: tải hỏng (link Zalo hết hạn) → trả 'failed' ngay, không chờ hết thời gian", async () => {
  const { db } = fakeDb([AttachmentStatus.Pending, AttachmentStatus.Failed]);
  const downloader: DownloadEnqueuer = { enqueue: () => {} };
  const started = Date.now();
  assert.equal(await requestAndAwaitDownload(db, downloader, 1, 5, 5_000), "failed");
  assert.ok(Date.now() - started < 1_000, "không được chờ tới hết timeout khi đã biết Failed");
});

test("requestAndAwaitDownload: còn Pending mãi tới hết thời gian → trả 'pending' (báo người dùng hỏi lại sau)", async () => {
  const { db } = fakeDb([AttachmentStatus.Pending]);
  const downloader: DownloadEnqueuer = { enqueue: () => {} };
  assert.equal(await requestAndAwaitDownload(db, downloader, 1, 5, 30), "pending");
});

// Giữ nguyên hành vi cũ (không liên quan phase 6) — chỉ chạy cạnh test mới cho gọn, không tách tệp riêng.
test("sanitizeFileName: đổi ký tự Windows cấm thành _, gộp khoảng trắng, cắt ở 120 ký tự", () => {
  assert.equal(sanitizeFileName('bao gia: "A" <B>|C?.pdf'), "bao gia_ _A_ _B_C_.pdf");
  assert.equal(sanitizeFileName("a".repeat(200)).length, 120);
});

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

test("resolveExtension: ảnh Zalo không đuôi, CDN trả octet-stream → nhận ra jpg qua chữ ký đầu tệp", () => {
  assert.equal(resolveExtension("", "application/octet-stream", JPEG_BYTES), "jpg");
  assert.equal(resolveExtension("", "image/jpg", Buffer.from("x")), "jpg");
});

test("resolveExtension: đuôi Zalo báo / content-type đi trước chữ ký; không nhận ra gì → bin", () => {
  assert.equal(resolveExtension("xlsx", "application/octet-stream", JPEG_BYTES), "xlsx");
  assert.equal(resolveExtension("", "image/png; charset=binary", JPEG_BYTES), "png");
  assert.equal(resolveExtension("", "application/octet-stream", Buffer.from("plain text")), "bin");
});

// Chống SSRF / cạn RAM ở cấp AttachmentDownloader (giả db + storage, không mạng thật).
function runDownloader(sourceUrl: string, fetcher: (url: string) => Promise<Response>, maxFileBytes = 100) {
  const updates: unknown[][] = [];
  const stored: Buffer[] = [];
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("SELECT")) {
        return [[{ id: 1, source_url: sourceUrl, file_name: "", file_ext: "", attempts: 0, zalo_group_id: "g", sent_at: new Date("2026-10-01") }]];
      }
      updates.push(params ?? []);
      return [{ affectedRows: 1 }];
    },
  } as unknown as Db;
  const storage = { put: async (key: string, body: Buffer) => { stored.push(body); return key; } } as unknown as FileStorage;
  const lookup = async (host: string) => (host === "cdn.test" ? ["93.184.216.34"] : ["10.0.0.9"]);
  const downloader = new AttachmentDownloader(db, storage, { concurrency: 1, maxFileBytes }, (url) => fetcher(url), lookup);
  return { downloader, updates, stored };
}

test("AttachmentDownloader: link tới IP nội bộ → Failed, không gọi fetcher, không lưu gì", async () => {
  let calls = 0;
  const { downloader, updates, stored } = runDownloader("http://169.254.169.254/latest/meta-data", async () => { calls += 1; return new Response("secret"); });
  downloader.enqueue(1);
  await downloader.drain();
  assert.equal(calls, 0);
  assert.equal(stored.length, 0);
  assert.equal(updates[0][0], AttachmentStatus.Failed);
});

test("AttachmentDownloader: CDN chuyển hướng vào 127.0.0.1 → Failed, chưa từng gọi tới đích nội bộ", async () => {
  const urls: string[] = [];
  const { downloader, updates, stored } = runDownloader("https://cdn.test/a.jpg", async (url) => {
    urls.push(url);
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:3306/" } });
  });
  downloader.enqueue(1);
  await downloader.drain();
  assert.deepEqual(urls, ["https://cdn.test/a.jpg"]);
  assert.equal(stored.length, 0);
  assert.equal(updates[0][0], AttachmentStatus.Failed);
});

test("AttachmentDownloader: thân vô hạn không content-length bị cắt ở trần → Failed", async () => {
  let pulls = 0;
  const infinite = new ReadableStream<Uint8Array>({ pull(c) { pulls += 1; c.enqueue(new Uint8Array(40)); } });
  const { downloader, updates, stored } = runDownloader("https://cdn.test/big", async () => new Response(infinite));
  downloader.enqueue(1);
  await downloader.drain();
  assert.ok(pulls < 10);
  assert.equal(stored.length, 0);
  assert.equal(updates[0][0], AttachmentStatus.Failed);
});

test("AttachmentDownloader: tải CDN bình thường → Stored", async () => {
  const { downloader, updates, stored } = runDownloader("https://cdn.test/a.png", async () => new Response(Buffer.from("png!"), { headers: { "content-type": "image/png" } }));
  downloader.enqueue(1);
  await downloader.drain();
  assert.equal(stored[0].toString(), "png!");
  assert.equal(updates[0][0], AttachmentStatus.Stored);
});
