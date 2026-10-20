import { callFilesCommand, filesMcpFor } from "./files-command-call.js";
import { readFileViaMcp } from "./file-read-via-mcp.js";
import { readFileLegacy, searchFilesLegacy, sendFileLegacy } from "./file-access-tools-legacy.js";
import { MAX_FILES_PER_TURN } from "./file-tool-shared.js";
import type { ToolContext } from "./tools.js";

// Ba công cụ tệp của trợ lý (search_files, read_file, send_file), rẽ nhánh theo họ `files`:
// - họ bật + phiên MCP có công cụ → qua MCP (`search_files` là công cụ MÔ HÌNH của máy chủ nên bộ định tuyến `resolveExecutor` đã đưa đi; ở đây chỉ còn đường cũ cho nó;
//   `read_file` / `send_file` là phía trợ lý gọi công cụ lệnh `file_read_prepare` / `file_send_check`);
// - họ tắt / không có phiên → đường cũ (`file-access-tools-legacy.ts`).
// Tác động ngoài (tải kho, AI bóc chữ, gửi tệp Zalo) luôn ở phía trợ lý. Trần `MAX_FILES_PER_TURN` giữ ở đây.

export { MAX_FILES_PER_TURN };

export const searchFiles = searchFilesLegacy;

export async function readFile(context: ToolContext, args: Record<string, unknown>) {
  const mcp = await filesMcpFor(context.mcp, "file_read_prepare");
  return mcp ? readFileViaMcp(mcp, context, args) : readFileLegacy(context, args);
}

export async function sendFile(context: ToolContext, args: Record<string, unknown>) {
  const mcp = await filesMcpFor(context.mcp, "file_send_check");
  if (!mcp) return sendFileLegacy(context, args);
  const attachmentId = Number(args.attachment_id);
  if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) return { error: "Thiếu attachment_id" };
  if (context.filesToSend.length >= MAX_FILES_PER_TURN) return { error: `Mỗi lần chỉ gửi tối đa ${MAX_FILES_PER_TURN} tệp.` };
  // Lõi kiểm quyền + tệp đã có trong kho rồi báo `effects.filesToSend`; bộ chuyển thêm id (không trùng) vào danh sách gửi của lượt
  return callFilesCommand(mcp, context, "file_send_check", { attachment_id: attachmentId });
}
