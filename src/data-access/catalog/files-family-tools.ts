import { fileReadPrepareTool } from "../files/file-read-prepare-tools.js";
import { fileSendCheckTool } from "../files/file-send-check-tools.js";
import { fileTextStoreTool } from "../files/file-text-store-tools.js";
import { linkSharedCheckTool } from "../files/link-shared-check-tools.js";
import { replySourcesTool } from "../files/reply-sources-tools.js";
import { searchFilesExternalTool, searchFilesModelTool } from "../operations/search-files-operation.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";
import type { FamilyCatalog } from "./family-catalog.js";
import { SUGGEST_REPLIES_PROMPT } from "./files-family-instructions.js";

// Họ `files` (phase 7 plan «trợ lý qua MCP»): tìm / đọc / gửi tệp, tra link, nguồn gợi ý trả lời.
// - `search_files`: đọc thuần ⇒ công cụ MÔ HÌNH (tên + khai báo + hình trả lời giữ nguyên) và bản cho cổng /mcp ngoài (có dặn dữ liệu không đáng tin). Bản cổng ngoài đứng
//   TRƯỚC bản mô hình cùng tên: tra theo tên (họ / dạng lỗi) lấy bản đứng sau = bản mô hình.
// - Năm công cụ LỆNH (`assistant_command`, mô hình không thấy): `file_read_prepare` / `file_text_store` (đọc tệp — cache chữ đã bóc), `file_send_check` (gửi tệp),
//   `link_shared_check` (đọc link), `reply_sources` (gợi ý trả lời). Tác động ngoài (tải kho, AI bóc chữ, gửi tệp Zalo, tải link, AI sinh nháp) ở PHÍA TRỢ LÝ — chỉ tra / ghi dữ liệu qua MCP.

const erase = <I, O>(tool: ToolDefinition<I, O>): AnyToolDefinition => eraseTool(tool);

export const filesFamilyCatalog: FamilyCatalog = {
  family: "files",
  tools: [
    erase(searchFilesExternalTool),
    erase(searchFilesModelTool),
    erase(fileReadPrepareTool),
    erase(fileTextStoreTool),
    erase(fileSendCheckTool),
    erase(linkSharedCheckTool),
    erase(replySourcesTool),
  ],
  actions: [],
  instructions: SUGGEST_REPLIES_PROMPT,
};
