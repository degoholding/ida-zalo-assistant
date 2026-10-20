// mcp-guard: legacy(send) — đường cũ của lệnh gửi gõ + kho «đồng ý» (đọc kho nháp trực tiếp); họ `send` bật thì send-command-chat.ts đi qua MCP; gỡ ở phase 13
import type { PendingStoreProvider } from "../assistant/chat-confirm-router.js";
import { cancelLatestDraft, cancelSendCommand, confirmDraft, listForRequester } from "./send-command-actions.js";
import { findLatestLiveDraft } from "./send-command-lifecycle-queries.js";
import { CONFIRM_TTL_MS } from "./send-command-limits.js";
import { createDraft } from "./send-command-draft-service.js";
import type { SendChatCommand } from "./send-command-parser.js";
import type { SendChatContext } from "./send-command-chat.js";
import { NOT_ALLOWED_REPLY } from "./send-command-replies.js";
import type { SendCommandRow } from "./send-command-types.js";

// Đường CŨ của lệnh gõ gửi tin (phase 9): gọi thẳng dịch vụ. «đồng ý» / «hủy» TRẦN không nằm ở parser (dùng chung với đổi cấu hình cảnh báo).

/** Chạy một lệnh gửi gõ tay, trả đúng câu bot nhắn lại. */
export async function runSendChatCommandLegacy(command: SendChatCommand, context: SendChatContext, now: Date = new Date()): Promise<string> {
  switch (command.kind) {
    case "send_draft": {
      if (!context.requester) return NOT_ALLOWED_REPLY;
      const result = await createDraft(context.deps, {
        requester: context.requester, requesterContactId: context.requesterContactId, question: context.question, targetNames: command.targetNames,
        scheduleText: command.scheduleText, body: command.body, withRecentFiles: command.withRecentFiles, sourceThreadId: context.sourceThreadId,
        sourceMessageId: context.sourceMessageId, botAccountId: context.botAccountId,
      }, now);
      return result.reply;
    }
    case "send_list":
      return listForRequester(context.deps, context.uid);
    case "send_cancel":
      return (await cancelSendCommand(context.deps, { via: "zalo", uid: context.uid, name: context.name }, command.commandId, now)).reply;
    case "send_confirm":
      if (!context.requester) return NOT_ALLOWED_REPLY;
      return (await confirmDraft(context.deps, context.requester, command.commandId, now)).reply;
  }
}

/** Lúc dựng nháp theo giờ APP: `confirm_expires_at` do app ghi = now + CONFIRM_TTL_MS (không dùng created_at — giờ DB, múi phiên DB). */
function draftIssuedAt(draft: SendCommandRow): number {
  return draft.confirmExpiresAt ? draft.confirmExpiresAt.getTime() - CONFIRM_TTL_MS : draft.createdAt.getTime();
}

/** Kho chờ xác nhận của nháp lệnh gửi (tin riêng): «đồng ý» / «hủy» trơn áp cho nháp còn sống mới nhất của người hỏi. */
export const sendPendingProviderLegacy: PendingStoreProvider = {
  async latest({ chat }) {
    const send = chat.send;
    const draft = send ? await findLatestLiveDraft(send.deps.db, send.uid, chat.now) : null;
    if (!send || !draft) return null;
    return {
      at: draftIssuedAt(draft),
      confirm: async () => (send.requester ? (await confirmDraft(send.deps, send.requester, draft.id, chat.now)).reply : NOT_ALLOWED_REPLY),
      cancel: async () => (await cancelLatestDraft(send.deps, send.uid, send.name, chat.now)).reply,
    };
  },
};
