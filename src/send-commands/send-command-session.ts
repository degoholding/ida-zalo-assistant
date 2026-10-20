import type { AskerAccess } from "../assistant/infra/asker-access.js";
import { resolveAssistantMcpBridge } from "../assistant/mcp-bridge/assistant-mcp-bridge-config.js";
import type { AssistantMcpTurn } from "../assistant/mcp-bridge/assistant-mcp-turn.js";
import { openMcpTurn } from "../assistant/mcp-bridge/open-mcp-turn.js";
import { ERROR_META_KEY } from "../mcp/mcp-meta-keys.js";

// Phiên MCP mặt `assistant_command` cho lớp lệnh của họ `send` (lệnh gửi gõ, «đồng ý» nháp gửi, tra bản tin, công cụ đề xuất phía trợ lý).
// Nguồn phiên: `mcp` (phiên dùng chung của lượt do nơi gọi mở / đóng) hoặc `access` (TỰ MỞ một phiên rồi đóng ngay). Không nguồn nào, họ `send` tắt, hay máy
// chủ không liệt kê đủ công cụ cần → null: nơi gọi chạy đường cũ (không bao giờ tự lùi giữa chừng — một lời gọi đã chạy thì không chạy lại).

export interface CommandSessionSource {
  mcp?: () => Promise<AssistantMcpTurn | undefined>;
  access?: () => Promise<AskerAccess>;
  /** Móc của ứng dụng (`SendCommandDeps` / `BriefChatDeps`) gắn vào ctx khi TỰ MỞ phiên. */
  deps?: { wakeJobs?: () => void; requestDownload?: (attachmentIds: number[]) => void };
}

export type CommandToolCall = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

interface ToolFailure { message?: string }

export async function withCommandSession<T>(
  source: CommandSessionSource, tools: readonly string[], run: (call: CommandToolCall) => Promise<T>,
): Promise<{ value: T } | null> {
  let turn: AssistantMcpTurn | undefined;
  let owned = false;
  if (source.mcp) {
    turn = await source.mcp();
  } else if (source.access) {
    turn = openMcpTurn(await source.access(), resolveAssistantMcpBridge(undefined), { wakeJobs: source.deps?.wakeJobs, requestDownload: source.deps?.requestDownload });
    owned = true;
  }
  try {
    if (!turn?.familyEnabled("send")) return null;
    const listed = await turn.command();
    if (!listed || !tools.every((name) => listed.toolNames.has(name))) return null;
    const active = turn;
    return { value: await run(async (name, args) => {
      const result = await active.callTool("assistant_command", name, args);
      if (result.isError || !result.structuredContent) {
        const failure = (result._meta as Record<string, unknown> | undefined)?.[ERROR_META_KEY] as ToolFailure | undefined;
        throw new Error(`lệnh gửi qua MCP lỗi (${name}): ${failure?.message ?? "không rõ"}`);
      }
      return result.structuredContent as Record<string, unknown>;
    }) };
  } finally {
    if (owned) await turn?.close();
  }
}
