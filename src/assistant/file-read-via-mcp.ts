import { AttachmentTextDeniedError } from "../storage/attachment-text-sql-cache.js";
import { mcpAttachmentTextStore, recordFromPrepare } from "./attachment-text-mcp-cache.js";
import { callFilesCommand } from "./files-command-call.js";
import { NOT_STORED_ERROR_PATTERN, shapeReadFileResult } from "./file-tool-shared.js";
import type { AssistantMcpTurn } from "./mcp-bridge/assistant-mcp-turn.js";
import type { ToolContext } from "./tools.js";

// `read_file` khi họ `files` bật: kiểm quyền + lấy chữ cache qua công cụ lệnh `file_read_prepare`; chưa có chữ thì tải kho + AI bóc (TÁC ĐỘNG NGOÀI — vẫn ở phía trợ lý, qua
// `context.readFile` = `readAttachmentText`) và cache ghi qua `file_text_store` (kho chữ MCP truyền thẳng cho `context.readFile`). Câu trả lời / lỗi cho mô hình y đường cũ.

export async function readFileViaMcp(mcp: AssistantMcpTurn, context: ToolContext, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!context.readFile) return { error: "Bot chưa bật đọc tệp" };
  const attachmentId = Number(args.attachment_id);
  if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) return { error: "Thiếu attachment_id" };
  const call = (name: string, callArgs: Record<string, unknown>) => callFilesCommand(mcp, context, name, callArgs);
  // Kiểm quyền TRƯỚC: ngoài phạm vi / ngoài nhóm đang hỏi → «Không có tệp này.», nhóm Mật chưa cờ → câu Mật (lõi quyết, mô hình không tự kiểm)
  const prepared = await call("file_read_prepare", { attachment_id: attachmentId });
  if ("error" in prepared) return prepared;
  const store = mcpAttachmentTextStore(call, recordFromPrepare(prepared));
  const read = async () => {
    try {
      return await context.readFile!(attachmentId, store);
    } catch (error) {
      if (error instanceof AttachmentTextDeniedError) return { error: error.message };
      throw error;
    }
  };
  let result = await read();
  // Tệp chưa có trong kho nhưng link Zalo còn tải lại được: đưa lại hàng tải rồi chờ ít lâu (như đường cũ) — hàng tải là tác động ngoài, ngoài MCP
  if ("error" in result && context.requestFileDownload && prepared.source_retryable === true && NOT_STORED_ERROR_PATTERN.test(String(result.error))) {
    const outcome = await context.requestFileDownload(attachmentId);
    if (outcome === "pending") return { error: "Em đang tải tệp này về, anh/chị hỏi lại giúp em sau ít phút nhé." };
    if (outcome === "failed") return { error: "Link tệp này trên Zalo đã hết hạn — anh/chị gửi lại tệp giúp em nhé." };
    result = await read(); // outcome === "stored" → đọc lại (load gọi lại file_read_prepare để thấy trạng thái mới)
  }
  if ("error" in result) return result;
  return shapeReadFileResult(context, result);
}
