import assert from "node:assert/strict";
import { test } from "node:test";
import { AttachmentStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { requestAndAwaitDownload, sanitizeFileName, type DownloadEnqueuer } from "./attachment-downloader.js";

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
