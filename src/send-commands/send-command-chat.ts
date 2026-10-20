// mcp-guard: legacy(send) — kho nháp gửi đọc qua send-command-lifecycle-queries; phase 12 chuyển sang họ `send`
import type { PendingStoreProvider } from "../assistant/chat-confirm-router.js";
import { cancelLatestDraft, cancelSendCommand, confirmDraft, listForRequester } from "./send-command-actions.js";
import { findLatestLiveDraft } from "./send-command-lifecycle-queries.js";
import { CONFIRM_TTL_MS } from "./send-command-limits.js";
import type { SendCommandDeps } from "./send-command-deps.js";
import { createDraft } from "./send-command-draft-service.js";
import type { SendChatCommand } from "./send-command-parser.js";
import type { SendCommandRow, SendRequester } from "./send-command-types.js";

// Cầu nối lệnh gõ → dịch vụ (phase 9): phase 4 gọi `runSendChatCommand` từ chat-commands.ts với kết quả `parseSendCommand`.
// «đồng ý» / «hủy» TRẦN không nằm ở parser (dùng chung với đổi cấu hình cảnh báo): chat-commands thử `confirmDraft(…, "latest")` /
// `cancelLatestDraft(…)` trước, `handled: false` thì chạy việc cũ.

/** Bot không nhận ra người này là người ra lệnh được. */
export const NOT_ALLOWED_REPLY = "Lệnh gửi tin chỉ dành cho người nhận cảnh báo hoặc Quản lý / Trưởng phòng ạ.";
/** Chỉ ra lệnh trong tin riêng với bot — nhóm không ra lệnh gửi. */
export const GROUP_NOT_ALLOWED_REPLY = "Anh/chị nhắn riêng cho em để ra lệnh gửi tin nhé — trong nhóm em không nhận lệnh gửi.";

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
}

/** Chạy một lệnh gửi gõ tay, trả đúng câu bot nhắn lại. */
export async function runSendChatCommand(command: SendChatCommand, context: SendChatContext, now: Date = new Date()): Promise<string> {
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
export const sendPendingProvider: PendingStoreProvider = {
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
