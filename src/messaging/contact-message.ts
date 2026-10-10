import { JobKind } from "../constants.js";
import type { Db } from "../db/pool.js";
import { enqueueJob } from "../jobs/job-queue.js";
import type { GeneratedReportFile } from "../reports/report-exporter.js";

// Bot nhắn một người / vào một cuộc có sẵn qua hàng đợi (JobKind.ContactMessage): ai cũng xếp được (worker không giữ phiên
// Zalo), tiến trình app giữ phiên gửi (SyncService.sendContactMessage). Dùng chung cho ticket (phase 11), việc (phase 7)
// và recap họp tự động (phase 4, meeting-recap-delivery.ts — kèm PDF qua `reportFiles`).

export interface ContactMessagePayload {
  /** Nhắn vào một cuộc có sẵn (riêng / nhóm) — hoặc nhắn riêng một người theo mã Zalo */
  threadId?: number;
  zaloUid?: string;
  name?: string;
  text?: string;
  attachmentIds?: number[];
  /** Vào NHÓM: gắn thẻ nhắc (@) những người này — chữ phải có «@Tên» đúng tên của họ trong nhóm */
  mentionUids?: string[];
  /** Tệp báo cáo đã cất kho (PDF recap…) — gửi tuần tự SAU chữ + mọi `attachmentIds` (khuôn RecipientMessagePayload, phase 8). */
  reportFiles?: GeneratedReportFile[];
  /** Tiến độ đã gửi của CHÍNH job này — sendContactMessage (sync-service.ts) tự ghi lại sau mỗi phần thành công để
   * thử lại (lỗi giữa chừng) không gửi lặp phần đã xong. */
  textSent?: boolean;
  /** Số tệp ĐẦU của `reportFiles` đã gửi xong — thử lại tiếp tục từ chỉ số này. */
  sentFileCount?: number;
}

export interface MessageQueueDeps {
  db: Db;
  /** Có việc mới trong hàng đợi — đánh thức bộ chạy việc */
  wakeJobs?: () => void;
}

/** Xếp một tin vào hàng đợi. Lỗi gửi thì hàng đợi thử lại; trễ quá 6 giờ thì thôi. `dedupeKey` trùng = không xếp lần hai. */
export async function enqueueContactMessage(deps: MessageQueueDeps, payload: ContactMessagePayload, dedupeKey: string, delayMs = 0): Promise<void> {
  const target = payload.threadId ? `thread:${payload.threadId}` : `uid:${payload.zaloUid}`;
  await enqueueJob(deps.db, {
    kind: JobKind.ContactMessage, payload, dedupeKey, serialKey: `contact:${target}`,
    runAfter: delayMs ? new Date(Date.now() + delayMs) : undefined, expiresInMs: 6 * 60 * 60_000, maxAttempts: 4,
  });
  deps.wakeJobs?.();
}
