import { CONFIDENTIAL_ERROR } from "./infra/asker-access.js";
import { AttachmentTextDeniedError, type AttachmentTextRecord, type AttachmentTextStore, type ExtractMethodName } from "../storage/attachment-text-sql-cache.js";

// Kho chữ đã bóc cho `readAttachmentText` trong lượt trợ lý khi họ `files` bật: ĐỌC dòng tệp + chữ cache qua công cụ lệnh `file_read_prepare`, GHI cache qua `file_text_store`
// (lõi kiểm quyền ở cả hai). Bóc chữ (Storage + AI) vẫn ở phía trợ lý — `readAttachmentText` làm, store chỉ lo dữ liệu.

export type FilesCommand = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Kết quả `file_read_prepare` (snake_case) → bản ghi store. */
export function recordFromPrepare(data: Record<string, unknown>): AttachmentTextRecord {
  const cached = data.cached as { method: ExtractMethodName; summary: string; text: string; char_count: number } | null;
  return {
    attachmentId: Number(data.attachment_id), fileName: String(data.file_name ?? ""), fileExt: String(data.file_ext ?? ""), status: Number(data.status),
    storageKey: typeof data.storage_key === "string" ? data.storage_key : null, storedBytes: typeof data.stored_bytes === "number" ? data.stored_bytes : null,
    cached: cached ? { method: cached.method, summary: cached.summary, text: cached.text, charCount: cached.char_count } : null,
  };
}

/** Lõi từ chối vì quyền (tệp ngoài phạm vi / nhóm Mật chưa cờ) — khác lỗi hệ thống (DB sập, giao thức…): lỗi hệ thống KHÔNG được báo thành «Không có tệp này». */
const isAccessDenial = (message: string): boolean => message === new AttachmentTextDeniedError().message || message === CONFIDENTIAL_ERROR;

/**
 * `preloaded` = kết quả `file_read_prepare` đã gọi để kiểm quyền (dùng đúng một lần cho lần `load` đầu, khỏi gọi lại); các lần `load` sau (đọc lại sau khi tải kho)
 * gọi lại công cụ để thấy trạng thái mới. Ghi bị từ chối vì quyền (tệp ra khỏi phạm vi giữa chừng) → `AttachmentTextDeniedError`; lỗi hệ thống → `Error` thường (không giả làm «không có tệp»).
 */
export function mcpAttachmentTextStore(call: FilesCommand, preloaded?: AttachmentTextRecord): AttachmentTextStore {
  let first = preloaded;
  return {
    async load(attachmentId) {
      if (first && first.attachmentId === attachmentId) {
        const record = first;
        first = undefined;
        return record;
      }
      const result = await call("file_read_prepare", { attachment_id: attachmentId });
      if (!("error" in result)) return recordFromPrepare(result);
      const message = String(result.error);
      if (isAccessDenial(message)) return null;
      throw new Error(`file_read_prepare lỗi: ${message}`);
    },
    async save(attachmentId, data) {
      const result = await call("file_text_store", {
        attachment_id: attachmentId, method: data.method, text: data.text, summary: data.summary, input_tokens: data.inputTokens, output_tokens: data.outputTokens,
      });
      if (!("error" in result)) return;
      const message = String(result.error);
      if (isAccessDenial(message)) throw new AttachmentTextDeniedError(message);
      throw new Error(`file_text_store lỗi: ${message}`);
    },
  };
}
