import type { RowDataPacket } from "mysql2";
import { AttachmentStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import type { FileStorage } from "../storage/file-storage.js";

// Link file của Zalo có hạn — tải NGAY lúc tin tới. Hàng đợi nằm trong tiến trình; tiến trình
// chết giữa chừng thì lúc khởi động lại quét các dòng Pending trong DB rồi tải tiếp.

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
};

const log = createLogger("file");

export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

interface AttachmentJob extends RowDataPacket {
  id: number;
  source_url: string;
  file_name: string;
  file_ext: string;
  attempts: number;
  zalo_group_id: string;
  sent_at: Date;
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\r\n\t]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function buildStorageKey(job: Pick<AttachmentJob, "id" | "zalo_group_id" | "sent_at" | "file_name" | "file_ext">,
  contentType: string): string {
  const month = job.sent_at.toISOString().slice(0, 7);
  const extension = job.file_ext || EXTENSION_BY_MIME[contentType.split(";")[0].trim()] || "bin";
  const baseName = job.file_name ? sanitizeFileName(job.file_name) : `tep.${extension}`;
  const name = /\.[a-z0-9]{1,10}$/i.test(baseName) ? baseName : `${baseName}.${extension}`;
  return `${job.zalo_group_id}/${month}/${job.id}-${name}`;
}

export class AttachmentDownloader {
  private readonly queue: number[] = [];
  private readonly queued = new Set<number>();
  private running = 0;
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly storage: FileStorage,
    private readonly options: { concurrency: number; maxFileBytes: number },
    private readonly fetcher: Fetcher = fetch,
  ) {}

  enqueue(attachmentId: number): void {
    if (this.stopped || this.queued.has(attachmentId)) return;
    this.queued.add(attachmentId);
    this.queue.push(attachmentId);
    this.pump();
  }

  /** Khởi động lại: nhặt các file còn dở từ lần chạy trước. */
  async resumePending(): Promise<number> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      "SELECT id FROM attachment WHERE status = ? ORDER BY id",
      [AttachmentStatus.Pending],
    );
    for (const row of rows) this.enqueue(row.id as number);
    return rows.length;
  }

  stop(): void {
    this.stopped = true;
  }

  /** Chờ hàng đợi rỗng — dùng trong bài kiểm và lúc tắt êm. */
  async drain(): Promise<void> {
    while (this.queue.length || this.running) await new Promise((resolve) => setTimeout(resolve, 20));
  }

  private pump(): void {
    while (!this.stopped && this.running < this.options.concurrency && this.queue.length) {
      const attachmentId = this.queue.shift()!;
      this.running += 1;
      this.process(attachmentId)
        .catch((error) => log.error(`tệp #${attachmentId} lỗi ngoài dự kiến`, error))
        .finally(() => {
          this.running -= 1;
          this.queued.delete(attachmentId);
          this.pump();
        });
    }
  }

  private async process(attachmentId: number): Promise<void> {
    const [rows] = await this.db.query<AttachmentJob[]>(
      `SELECT a.id, a.source_url, a.file_name, a.file_ext, a.attempts, g.zalo_group_id, m.sent_at
       FROM attachment a
       JOIN message m ON m.id = a.message_id
       JOIN zalo_group g ON g.id = a.group_id
       WHERE a.id = ? AND a.status = ?`,
      [attachmentId, AttachmentStatus.Pending],
    );
    const job = rows[0];
    if (!job) return;

    try {
      const { body, contentType } = await this.download(job.source_url);
      const storageKey = await this.storage.put(buildStorageKey(job, contentType), body, contentType);
      // Ảnh nhập từ Zalo Web nằm nguyên trong source_url (data URL, tới vài MB) — cất xong thì bỏ, khỏi phình bảng
      await this.db.query(
        `UPDATE attachment SET status = ?, storage_key = ?, stored_bytes = ?, attempts = attempts + 1,
           last_error = '', stored_at = CURRENT_TIMESTAMP(3),
           source_url = IF(source_url LIKE 'data:%', '', source_url) WHERE id = ?`,
        [AttachmentStatus.Stored, storageKey, body.length, job.id],
      );
    } catch (error) {
      const attempts = job.attempts + 1;
      const permanent = error instanceof PermanentDownloadError || attempts >= MAX_ATTEMPTS;
      await this.db.query(
        "UPDATE attachment SET status = ?, attempts = ?, last_error = ? WHERE id = ?",
        [permanent ? AttachmentStatus.Failed : AttachmentStatus.Pending, attempts,
         describeError(error).slice(0, 500), job.id],
      );
      log.warn(`tệp #${job.id} tải hỏng lần ${attempts}${permanent ? " — bỏ" : ", thử lại sau"}`, error);
      if (!permanent) setTimeout(() => this.enqueue(job.id), RETRY_DELAY_MS * attempts).unref();
    }
  }

  private async download(url: string): Promise<{ body: Buffer; contentType: string }> {
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (response.status === 403 || response.status === 404 || response.status === 410) {
      throw new PermanentDownloadError(`HTTP ${response.status} — link đã chết`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (declared > this.options.maxFileBytes) {
      throw new PermanentDownloadError(`Tệp ${declared} byte vượt trần ${this.options.maxFileBytes}`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > this.options.maxFileBytes) {
      throw new PermanentDownloadError(`Tệp ${body.length} byte vượt trần ${this.options.maxFileBytes}`);
    }
    return { body, contentType: response.headers.get("content-type") ?? "application/octet-stream" };
  }
}

class PermanentDownloadError extends Error {}
