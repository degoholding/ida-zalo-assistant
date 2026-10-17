import type { RowDataPacket } from "mysql2";
import { readAttachmentText } from "../assistant/file-reader.js";
import type { ModelClient } from "../assistant/gemini-client.js";
import { maskSecrets } from "../assistant/key-chain-client.js";
import type { AppConfig } from "../config.js";
import { AttachmentStatus, ConversationType, FlagSource, MessageKind, MessagePriority, ReplyState } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import type { FileStorage } from "../storage/file-storage.js";
import { processableThreadSql } from "../sync/collect-only.js";
import { buildAlertModelClient, systemTokensToday } from "./ai-review.js";

// Tự đọc ảnh gửi trong nhóm (15/10/2026): ảnh vừa cất kho → mô hình chép chữ + mô tả ngắn (cất attachment_text như khi
// trợ lý được nhờ đọc) → gắn cờ «chờ AI» để lô xét khẩn 5 phút (ai-review.ts) xét «chú thích [Ảnh: …]» như tin chữ (ảnh
// lô hàng vón cục, phiếu giao sai…; lô đó chỉ nhìn 2 giờ gần nhất nên ảnh cũ không bắn cảnh báo trễ). Chữ đã đọc cũng
// giúp tóm tắt nhóm, điểm tin bản tin, tìm tệp theo nội dung. Nhóm Mật không bao giờ đưa cho AI; chỉ nhóm bật «Đọc tin»;
// chỉ ảnh cất trong 24 giờ (bật lên không đọc ngược cả kho). Token tính vào trần ngày, nhưng đọc ảnh chỉ được tiêu tới
// IMAGE_TOKEN_SHARE trần — chừa phần còn lại cho xét khẩn tin chữ, bản tin, trợ lý.

const log = createLogger("image-read");
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
/** Mỗi lượt (2 phút) đọc tối đa ngần này ảnh — một lần gọi mô hình mỗi ảnh. */
const MAX_IMAGES_PER_RUN = 10;
const LOOKBACK_MS = 24 * 60 * 60_000;
/** Đọc ảnh dừng khi token hệ thống hôm nay chạm ngần này phần trần ngày. */
const IMAGE_TOKEN_SHARE = 0.5;
/** Đọc hỏng (hãng AI quá tải 503, hết hạn mức…) thì thử lại sau ngần này, tối đa MAX_ATTEMPTS lần mỗi ảnh. */
const RETRY_AFTER_MS = 30 * 60_000;
const MAX_ATTEMPTS = 3;
/** Dòng attachment_text của lần đọc hỏng: summary «tự đọc ảnh lỗi lần <n>: <lỗi>», text NULL. */
const FAILED_PREFIX = "tự đọc ảnh lỗi lần";

interface ImageCandidate extends RowDataPacket {
  attachment_id: number;
  message_id: number;
  group_id: number;
  failed_summary: string | null;
}

export interface ImageReadResult {
  read: number;
  failed: number;
  skipped: string;
}

/** Đuôi ảnh được tự đọc: giao với «Loại tệp bot được đọc» (rỗng = mọi loại). */
export function autoReadableImageExtensions(readableFileTypes: string[]): string[] {
  return readableFileTypes.length ? IMAGE_EXTENSIONS.filter((ext) => readableFileTypes.includes(ext)) : IMAGE_EXTENSIONS;
}

/** Số lần đã đọc hỏng, lấy từ summary «tự đọc ảnh lỗi lần <n>: …»; chưa hỏng lần nào = 0. */
export function failedAttempts(summary: string | null): number {
  const match = /^tự đọc ảnh lỗi lần (\d+):/.exec(summary ?? "");
  return match ? Number(match[1]) : 0;
}

async function loadCandidates(db: Db, config: AppConfig, extensions: string[], now: Date): Promise<ImageCandidate[]> {
  const retryPatterns = Array.from({ length: MAX_ATTEMPTS - 1 }, (_, index) => `${FAILED_PREFIX} ${index + 1}:%`);
  const [rows] = await db.query<ImageCandidate[]>(
    `SELECT a.id AS attachment_id, m.id AS message_id, m.group_id, t.summary AS failed_summary
     FROM attachment a
     JOIN message m ON m.id = a.message_id
     JOIN zalo_group g ON g.id = a.group_id
     LEFT JOIN attachment_text t ON t.attachment_id = a.id
     WHERE a.status = ? AND a.stored_at > ? AND a.file_ext IN (?) AND a.stored_bytes <= ?
       AND (t.attachment_id IS NULL
         OR (t.text IS NULL AND t.extracted_at < ? AND (${retryPatterns.map(() => "t.summary LIKE ?").join(" OR ")})))
       AND g.thread_type = ? AND g.read_messages = 1 AND g.is_confidential = 0 AND ${processableThreadSql("g")}
       AND m.kind = ? AND m.recalled_at IS NULL
       AND m.sender_uid NOT IN (SELECT zalo_uid FROM bot_account WHERE zalo_uid IS NOT NULL)
     ORDER BY (t.attachment_id IS NULL) DESC, a.id
     LIMIT ?`,
    [AttachmentStatus.Stored, new Date(now.getTime() - LOOKBACK_MS), extensions, config.assistant.maxReadFileBytes,
      new Date(now.getTime() - RETRY_AFTER_MS), ...retryPatterns, ConversationType.Group, MessageKind.Image, MAX_IMAGES_PER_RUN]);
  return rows;
}

/**
 * Đọc hỏng: ghi dòng không chữ kèm số lần — lượt sau bỏ qua, quá RETRY_AFTER_MS thì thử lại (lỗi hãng thường tạm thời),
 * tới MAX_ATTEMPTS thì thôi. Trợ lý được nhờ đọc vẫn đọc lại được ngay (dòng không chữ = chưa bóc). Câu lỗi hiện ở màn Tệp
 * nên che khóa AI.
 */
async function markReadFailed(db: Db, attachmentId: number, attempt: number, error: string): Promise<void> {
  await db.query(
    `INSERT INTO attachment_text (attachment_id, method, char_count, summary, text) VALUES (?, 'unsupported', 0, ?, NULL)
     ON DUPLICATE KEY UPDATE summary = IF(text IS NULL, VALUES(summary), summary),
       extracted_at = IF(text IS NULL, CURRENT_TIMESTAMP(3), extracted_at)`,
    [attachmentId, `${FAILED_PREFIX} ${attempt}: ${maskSecrets(error)}`.slice(0, 500)]);
}

/**
 * Ảnh đã có chữ → nhờ lô xét khẩn (ai-review.ts) xét. Chỉ tin CHƯA có mức (chưa có cờ, hoặc cờ mức thường): tin đã
 * khẩn / quan trọng theo từ khóa chú thích thì giữ nguyên — gắn «chờ AI» lên tin khẩn sẽ hoãn cảnh báo của nó.
 */
async function queueForReview(db: Db, candidate: ImageCandidate): Promise<void> {
  await db.query(
    `INSERT INTO message_flag (message_id, group_id, priority, reply_state, source, reason, pending_ai) VALUES (?, ?, ?, ?, ?, '', 1)
     ON DUPLICATE KEY UPDATE pending_ai = IF(priority = ${MessagePriority.Normal}, 1, pending_ai)`,
    [candidate.message_id, candidate.group_id, MessagePriority.Normal, ReplyState.NotNeeded, FlagSource.Ai]);
}

/** Một lượt tự đọc ảnh. `client` = null thì tự dựng từ bảng Khóa AI (như lô xét khẩn). */
export async function runImageAutoRead(
  db: Db, storage: FileStorage, config: AppConfig, now = new Date(), client?: ModelClient | null,
): Promise<ImageReadResult> {
  if (!config.assistant.autoReadImages) return { read: 0, failed: 0, skipped: "đã tắt" };
  const extensions = autoReadableImageExtensions(config.assistant.readableFileTypes);
  if (!extensions.length) return { read: 0, failed: 0, skipped: "ảnh không nằm trong loại tệp bot được đọc" };
  const candidates = await loadCandidates(db, config, extensions, now);
  if (!candidates.length) return { read: 0, failed: 0, skipped: "" };
  const budget = config.assistant.dailyTokenCap * IMAGE_TOKEN_SHARE;
  if (await systemTokensToday(db, now) >= budget) return { read: 0, failed: 0, skipped: "chạm phần trần token dành cho đọc ảnh" };
  const model = client === undefined ? await buildAlertModelClient(db, config) : client;
  if (!model?.readDocument) return { read: 0, failed: 0, skipped: "chưa có khóa AI đọc được ảnh" };
  const readDocument = model.readDocument.bind(model);

  let read = 0;
  let failed = 0;
  for (const candidate of candidates) {
    if (await systemTokensToday(db, now) >= budget) break;
    const attempt = failedAttempts(candidate.failed_summary) + 1;
    const started = Date.now();
    let error: string;
    try {
      const result = await readAttachmentText({
        db, storage, maxFileBytes: config.assistant.maxReadFileBytes, allowedExtensions: extensions,
        // Mô hình thường (không phải bản nặng) — chép chữ ảnh chụp đủ tốt, rẻ hơn nhiều khi đọc mọi ảnh
        readDocument: (mime, data, instruction) => readDocument(mime, data, instruction),
      }, candidate.attachment_id);
      if (!("error" in result)) {
        if (!result.cached) {
          await db.query(
            `INSERT INTO system_ai_usage (purpose, model, item_count, input_tokens, output_tokens, duration_ms) VALUES ('image-read', ?, 1, ?, ?, ?)`,
            [String((model as { lastModel?: string }).lastModel ?? "").slice(0, 80), result.inputTokens, result.outputTokens, Date.now() - started]);
        }
        if (result.text.trim()) await queueForReview(db, candidate);
        read += 1;
        continue;
      }
      error = result.error;
    } catch (thrown) {
      // Tệp mất khỏi kho, R2 lỗi… — ghi hỏng như lỗi mô hình để ảnh này không chặn đầu hàng mãi
      error = describeError(thrown);
    }
    failed += 1;
    log.warn(`ảnh #${candidate.attachment_id} (tin #${candidate.message_id}) tự đọc hỏng lần ${attempt}: ${maskSecrets(error)}`);
    await markReadFailed(db, candidate.attachment_id, attempt, error);
    // Hãng AI đang lỗi thì ảnh kế cũng hỏng — dừng lượt này, lượt sau (2 phút) đọc tiếp các ảnh còn lại
    break;
  }
  if (read) log.info(`tự đọc ${read} ảnh — chờ lô xét khẩn`);
  return { read, failed, skipped: "" };
}
