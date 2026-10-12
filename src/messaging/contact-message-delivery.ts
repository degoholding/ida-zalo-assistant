import type { RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";
import type { JobRow } from "../jobs/job-queue.js";
import { findThreadById, type GroupRow } from "../sync/group-repository.js";
import type { AccountRunner } from "../zalo/account-runner.js";
import type { ContactMessagePayload } from "./contact-message.js";

// Giao một tin `ContactMessagePayload` ra Zalo (tách từ SyncService.sendContactMessage, phase 9). Dùng chung cho job
// ContactMessage (ticket / việc / recap họp) và job SendCommandTarget (lệnh gửi). Tiến độ từng phần (chữ, tệp đính kèm,
// tệp báo cáo) ghi ngay vào payload của CHÍNH job này — lỗi giữa chừng rồi thử lại không gửi lặp phần đã xong.

export interface ContactDeliveryDeps {
  db: Db;
  /** Tài khoản bot gửi được vào cuộc này (tin riêng → bot chủ cuộc; nhóm → bot đang ở nhóm); ném lỗi nếu không có bot nào chạy */
  runnerForThread(thread: GroupRow): Promise<AccountRunner>;
  /** Tài khoản bot đã có cuộc riêng với người này (chưa có thì bot đầu tiên); ném lỗi nếu không có bot nào chạy */
  runnerForUid(zaloUid: string): Promise<AccountRunner>;
}

/**
 * `attachmentIds` chưa vào kho thì đợi lượt thử sau; lượt cuối gửi những tệp đã có. `sentAttachmentCount` = số tệp ĐẦU của
 * `attachmentIds` đã xử lý xong (gửi hoặc bị bỏ ở lượt cuối) — tính theo vị trí trong `attachmentIds` nên không lệch khi
 * danh sách tệp sẵn sàng thay đổi giữa các lượt. Lỗi thì ném — hàng đợi thử lại.
 */
export async function deliverContactMessage(deps: ContactDeliveryDeps, payload: ContactMessagePayload, job: JobRow): Promise<void> {
  const attachmentIds = payload.attachmentIds ?? [];
  let ready = new Set(attachmentIds);
  if (attachmentIds.length) {
    const [rows] = await deps.db.query<RowDataPacket[]>("SELECT id FROM attachment WHERE id IN (?) AND status = 1", [attachmentIds]);
    ready = new Set(attachmentIds.filter((id) => rows.some((row) => Number(row.id) === id)));
    const lastAttempt = job.attempts >= job.maxAttempts;
    if (ready.size < attachmentIds.length && !lastAttempt) throw new Error(`còn ${attachmentIds.length - ready.size} tệp chưa tải về kho`);
  }
  const persistProgress = async (patch: Partial<ContactMessagePayload>): Promise<void> => {
    Object.assign(payload, patch);
    await deps.db.query("UPDATE job SET payload = ? WHERE id = ?", [JSON.stringify(payload), job.id]);
  };
  const files = payload.reportFiles ?? [];

  /** Gửi tuần tự: chữ → tệp đính kèm → tệp báo cáo; mỗi phần xong là ghi tiến độ. */
  const sendAll = async (sender: {
    text(text: string): Promise<void>;
    stored(attachmentId: number): Promise<void>;
    report(file: NonNullable<ContactMessagePayload["reportFiles"]>[number]): Promise<void>;
  }): Promise<void> => {
    if (payload.text && !payload.textSent) {
      await sender.text(payload.text);
      await persistProgress({ textSent: true });
    }
    for (let index = payload.sentAttachmentCount ?? 0; index < attachmentIds.length; index += 1) {
      if (ready.has(attachmentIds[index])) await sender.stored(attachmentIds[index]);
      await persistProgress({ sentAttachmentCount: index + 1 });
    }
    for (let index = payload.sentFileCount ?? 0; index < files.length; index += 1) {
      await sender.report(files[index]);
      await persistProgress({ sentFileCount: index + 1 });
    }
  };

  if (payload.threadId) {
    const thread = await findThreadById(deps.db, payload.threadId);
    if (!thread) return;
    const runner = await deps.runnerForThread(thread);
    await sendAll({
      text: (text) => runner.sendThreadText(thread, text, payload.mentionUids),
      stored: (id) => runner.sendThreadStoredFile(thread, id),
      report: (file) => runner.sendReportFile(thread, file),
    });
    return;
  }
  if (!payload.zaloUid) return;
  const zaloUid = payload.zaloUid;
  const runner = await deps.runnerForUid(zaloUid);
  await sendAll({
    text: (text) => runner.sendDirectText(zaloUid, payload.name ?? "", text),
    stored: (id) => runner.sendDirectStoredFile(zaloUid, id),
    report: (file) => runner.sendDirectReportFile(zaloUid, payload.name ?? "", file),
  });
}
