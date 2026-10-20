import type { RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";

// Kho chữ đã bóc của tệp (bảng `attachment_text`) cho `readAttachmentText`: dòng tệp + chữ cache (`load`) và ghi cache (`save`).
// Bản SQL này là mặc định của ĐƯỜNG HỆ THỐNG (ảnh tự đọc, màn Tệp, worker); bản của trợ lý đi qua MCP nằm ở `src/assistant/attachment-text-mcp-cache.ts`.

export type ExtractMethodName = "text" | "xlsx" | "docx" | "gemini" | "unsupported";

/** Dòng tệp + chữ cache (nếu đã bóc). `storageKey` / `storedBytes` chỉ để đọc tệp trong kho, không bao giờ ra mô hình. */
export interface AttachmentTextRecord {
  attachmentId: number;
  fileName: string;
  fileExt: string;
  status: number;
  storageKey: string | null;
  storedBytes: number | null;
  /** null = chưa có chữ (chưa bóc lần nào, hoặc đã thử mà `unsupported` — `text` NULL không tính là cache). */
  cached: { method: ExtractMethodName; summary: string; text: string; charCount: number } | null;
}

export interface AttachmentTextSave {
  method: ExtractMethodName;
  /** null khi `method` = `unsupported`. */
  text: string | null;
  summary: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AttachmentTextStore {
  load(attachmentId: number): Promise<AttachmentTextRecord | null>;
  save(attachmentId: number, data: AttachmentTextSave): Promise<void>;
}

/** Bị từ chối ghi cache (tệp ra khỏi phạm vi người hỏi giữa lúc bóc chữ) — nơi gọi trả «Không có tệp này». */
export class AttachmentTextDeniedError extends Error {
  constructor(message = "Không có tệp này.") {
    super(message);
    this.name = "AttachmentTextDeniedError";
  }
}

export function sqlAttachmentTextStore(db: Db): AttachmentTextStore {
  return {
    async load(attachmentId) {
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT a.id, a.file_name, a.file_ext, a.status, a.storage_key, a.stored_bytes, t.method, t.summary, t.text, t.char_count
         FROM attachment a LEFT JOIN attachment_text t ON t.attachment_id = a.id WHERE a.id = ?`, [attachmentId]);
      const row = rows[0];
      if (!row) return null;
      return {
        attachmentId: Number(row.id), fileName: String(row.file_name ?? ""), fileExt: String(row.file_ext ?? ""), status: Number(row.status),
        storageKey: row.storage_key ? String(row.storage_key) : null, storedBytes: row.stored_bytes === null ? null : Number(row.stored_bytes),
        cached: row.text !== null && row.text !== undefined
          ? { method: row.method, summary: String(row.summary), text: String(row.text), charCount: Number(row.char_count) } : null,
      };
    },
    async save(attachmentId, data) {
      const text = data.text ?? "";
      await db.query(
        `INSERT INTO attachment_text (attachment_id, method, char_count, summary, text, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE method = VALUES(method), char_count = VALUES(char_count), summary = VALUES(summary), text = VALUES(text),
           input_tokens = VALUES(input_tokens), output_tokens = VALUES(output_tokens), extracted_at = CURRENT_TIMESTAMP(3)`,
        [attachmentId, data.method, text.length, data.summary.slice(0, 500), data.method === "unsupported" ? null : text, data.inputTokens, data.outputTokens]);
    },
  };
}
