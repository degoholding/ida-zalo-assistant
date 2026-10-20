import type { AssistantMcpTurn } from "./mcp-bridge/assistant-mcp-turn.js";
import { mapCallToolResult, type TurnEffectsSink } from "./mcp-bridge/mcp-call-result-mapper.js";

// Cầu nối PHÍA TRỢ LÝ tới công cụ lệnh của họ `files` (mặt `assistant_command` — mô hình không thấy): chỉ lượt có phiên MCP, họ `files` bật và máy chủ liệt kê đúng công cụ
// mới đi đường MCP; không thì nơi gọi chạy đường cũ (`*-legacy.ts`). Công cụ họ này chỉ ĐỌC / ghi cache chữ nên lùi về đường cũ khi phiên không mở được là an toàn (không ghi hai lần).

/** Phiên của lượt nếu `tool` (công cụ lệnh của họ `files`) chạy được qua MCP; null = dùng đường cũ. */
export async function filesMcpFor(mcp: AssistantMcpTurn | undefined, tool: string): Promise<AssistantMcpTurn | null> {
  if (!mcp?.familyEnabled("files")) return null;
  const session = await mcp.command();
  return session?.toolNames.has(tool) ? mcp : null;
}

/** `tools/call` công cụ lệnh; lỗi nghiệp vụ → `{ error: "<chữ>" }` như công cụ cũ, thành công → `structuredContent`, tác động lượt ghi vào `sink`. */
export async function callFilesCommand(mcp: AssistantMcpTurn, sink: TurnEffectsSink, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return mapCallToolResult(sink, await mcp.callTool("assistant_command", name, args), "string");
}
