// mcp-guard: legacy(send) — đường cũ tạo nháp ghim / lời mời họp gọi thẳng dịch vụ nháp; họ `send` bật thì send-assisted-draft.ts đi qua MCP; gỡ ở phase 13
import type { SendChatContext } from "./send-command-chat.js";
import { createDraft, type CreateDraftResult } from "./send-command-draft-service.js";
import { createPinDraft } from "./send-pin-draft-service.js";

export function createPinDraftLegacy(chat: SendChatContext, input: { groups: string[]; content: string }, now: Date): Promise<CreateDraftResult> {
  return createPinDraft(chat.deps, {
    requester: chat.requester!, requesterContactId: chat.requesterContactId, question: chat.question, groupNames: input.groups, content: input.content,
    sourceThreadId: chat.sourceThreadId, sourceMessageId: chat.sourceMessageId, botAccountId: chat.botAccountId,
  }, now);
}

/** Lời mời họp: nội dung do MÁY CHỦ dựng từ Calendar (`trustedBody`) — chỉ tên nơi nhận phải nằm trong tin người hỏi. */
export function createAnnouncementDraftLegacy(chat: SendChatContext, input: { groups: string[]; body: string }, now: Date): Promise<CreateDraftResult> {
  return createDraft(chat.deps, {
    requester: chat.requester!, requesterContactId: chat.requesterContactId, question: chat.question, targetNames: input.groups,
    scheduleText: "", body: input.body, trustedBody: true, withRecentFiles: false,
    sourceThreadId: chat.sourceThreadId, sourceMessageId: chat.sourceMessageId, botAccountId: chat.botAccountId,
  }, now);
}
