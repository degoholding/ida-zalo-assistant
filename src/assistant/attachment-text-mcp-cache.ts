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

/**
 * `preloaded` = kết quả `file_read_prepare` đã gọi để kiểm quyền (dùng đúng một lần cho lần `load` đầu, khỏi gọi lại); các lần `load` sau (đọc lại sau khi tải kho)
 * gọi lại công cụ để thấy trạng thái mới. Ghi bị từ chối (tệp ra khỏi phạm vi giữa chừng) → `AttachmentTextDeniedError`.
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
      return "error" in result ? null : recordFromPrepare(result);
    },
    async save(attachmentId, data) {
      const result = await call("file_text_store", {
        attachment_id: attachmentId, method: data.method, text: data.text, summary: data.summary, input_tokens: data.inputTokens, output_tokens: data.outputTokens,
      });
      if ("error" in result) throw new AttachmentTextDeniedError(String(result.error));
    },
  };
}
