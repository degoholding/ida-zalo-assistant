import type { ReadFileResult } from "./file-reader.js";

// Phần dùng chung của hai đường công cụ tệp (đường cũ `file-access-tools-legacy.ts` và đường qua MCP `file-read-via-mcp.ts`): trần, mẫu câu báo, hình kết quả `read_file`.
// Cả hai đường phải trả mô hình CÙNG chữ — nên hình kết quả nằm một chỗ.

export const MAX_FILES_PER_TURN = 3;
/** Chữ đưa cho mô hình tối đa ngần này ký tự một lượt — hơn thì cắt và nói rõ. */
export const READ_FILE_MAX_CHARS = 60_000;
/** Đúng câu báo của readAttachmentText (file-reader.ts) khi tệp chưa Stored — chỉ khi khớp câu NÀY mới thử tải lại,
 * tránh tải lại oan cho lỗi khác (đuôi tệp bị chặn, quá cỡ…) vẫn đi qua cùng nhánh "error" in result. */
export const NOT_STORED_ERROR_PATTERN = /chưa có trong kho/;

/** Phần của ngữ cảnh lượt mà kết quả đọc tệp ghi vào: token + «lượt nặng». */
export interface ReadFileSink {
  usage?: { inputTokens: number; outputTokens: number };
  markHeavy?: (reason: string) => void;
}

/** Kết quả đọc tệp thành công → hình trả mô hình (cộng token, đánh dấu lượt nặng, cắt chữ dài). */
export function shapeReadFileResult(sink: ReadFileSink, result: ReadFileResult) {
  if (sink.usage) {
    sink.usage.inputTokens += result.inputTokens;
    sink.usage.outputTokens += result.outputTokens;
  }
  sink.markHeavy?.(`đọc tệp ${result.fileName}`);
  const truncated = result.text.length > READ_FILE_MAX_CHARS;
  return {
    file: result.fileName,
    how: result.method,
    summary: result.summary,
    char_count: result.charCount,
    truncated,
    content: truncated ? result.text.slice(0, READ_FILE_MAX_CHARS) : result.text,
  };
}
