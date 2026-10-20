import type { PendingStoreProvider } from "../assistant/chat-confirm-router.js";
import type { AskerAccess } from "../assistant/infra/asker-access.js";
import type { AssistantMcpTurn } from "../assistant/mcp-bridge/assistant-mcp-turn.js";
import { runSendChatCommandLegacy, sendPendingProviderLegacy } from "./send-command-chat-legacy.js";
import type { SendCommandDeps } from "./send-command-deps.js";
import type { SendChatCommand } from "./send-command-parser.js";
import { NOT_ALLOWED_REPLY } from "./send-command-replies.js";
import { withCommandSession, type CommandToolCall } from "./send-command-session.js";
import type { SendRequester } from "./send-command-types.js";

// Cầu nối lệnh gõ → họ `send` (phase 12): chat-commands.ts gọi `runSendChatCommand` với kết quả `parseSendCommand`. Họ `send` BẬT (ngữ cảnh có nguồn
// phiên MCP) → công cụ lệnh của máy chủ MCP trong tiến trình (mặt `assistant_command`; luật quyền / trần / chặn sửa chữ / xem trước ở lõi `data-access/send/`);
// họ TẮT → đường cũ send-command-chat-legacy.ts. «đồng ý» / «hủy» TRẦN không nằm ở parser (dùng chung với đổi cấu hình cảnh báo): chat-confirm-router chọn
// kho mới nhất qua `sendPendingProvider`. Mốc giờ của đường MCP là `now` của ngữ cảnh truy cập (cùng đồng hồ với `now` của lượt).

export { GROUP_NOT_ALLOWED_REPLY, NOT_ALLOWED_REPLY } from "./send-command-replies.js";

export interface SendChatContext {
  deps: SendCommandDeps;
  /** null = không phải người nhận đang bật và không có vai trò */
  requester: SendRequester | null;
  /** Mã Zalo + tên người gõ (dùng cho «lệnh gửi», «hủy» khi chưa xác định được quyền) */
  uid: string;
  name: string;
  requesterContactId?: number | null;
  /** Nguyên văn tin vừa gõ */
  question: string;
  /** Cuộc riêng của tin lệnh (không phải nhóm) */
  sourceThreadId: number;
  sourceMessageId?: number | null;
  botAccountId?: number | null;
  /** Phiên MCP dùng chung của lượt (nơi mở lo đóng). Thiếu cả hai nguồn phiên = đường cũ. */
  mcp?: () => Promise<AssistantMcpTurn | undefined>;
  /** Ngữ cảnh truy cập của người hỏi — có mà không có `mcp` thì mỗi lần dùng TỰ MỞ một phiên rồi đóng. */
  access?: () => Promise<AskerAccess>;
}

const COMMAND_TOOLS = ["send_draft_create", "send_draft_confirm", "send_draft_cancel", "send_draft_list"] as const;
const PENDING_TOOLS = ["send_draft_pending", "send_draft_confirm", "send_draft_cancel"] as const;

const replyOf = (data: Record<string, unknown>): string => String(data.reply ?? "");

async function runViaMcp(call: CommandToolCall, command: SendChatCommand, context: SendChatContext): Promise<string> {
  switch (command.kind) {
    case "send_draft":
      if (!context.requester) return NOT_ALLOWED_REPLY;
      return replyOf(await call("send_draft_create", {
        question: context.question, target_names: command.targetNames, schedule_text: command.scheduleText, body: command.body,
        with_recent_files: command.withRecentFiles,
      }));
    case "send_list":
      return replyOf(await call("send_draft_list", {}));
    case "send_cancel":
      return replyOf(await call("send_draft_cancel", { command_id: command.commandId }));
    case "send_confirm":
      if (!context.requester) return NOT_ALLOWED_REPLY;
      return replyOf(await call("send_draft_confirm", { command_id: command.commandId }));
  }
}

/** Chạy một lệnh gửi gõ tay, trả đúng câu bot nhắn lại. */
export async function runSendChatCommand(command: SendChatCommand, context: SendChatContext, now: Date = new Date()): Promise<string> {
  const via = await withCommandSession(context, COMMAND_TOOLS, (call) => runViaMcp(call, command, context));
  return via ? via.value : runSendChatCommandLegacy(command, context, now);
}

/** Kho chờ xác nhận của nháp lệnh gửi (tin riêng): «đồng ý» / «hủy» trơn áp cho nháp còn sống mới nhất của người hỏi. */
export const sendPendingProvider: PendingStoreProvider = {
  async latest(input) {
    const send = input.chat.send;
    if (!send) return null;
    const via = await withCommandSession(send, PENDING_TOOLS, (call) => call("send_draft_pending", {}));
    if (!via) return sendPendingProviderLegacy.latest(input);
    const pending = via.value;
    if (pending.pending !== true || typeof pending.command_id !== "number" || typeof pending.issued_at !== "number") return null;
    const commandId = pending.command_id;
    const act = async (tool: "send_draft_confirm" | "send_draft_cancel", commandRef: number | "latest"): Promise<string> => {
      const done = await withCommandSession(send, [tool], (call) => call(tool, { command_id: commandRef }));
      if (!done) throw new Error("phiên MCP của lệnh gửi không còn mở được lúc xác nhận");
      return replyOf(done.value);
    };
    return { at: pending.issued_at, confirm: () => act("send_draft_confirm", commandId), cancel: () => act("send_draft_cancel", "latest") };
  },
};
