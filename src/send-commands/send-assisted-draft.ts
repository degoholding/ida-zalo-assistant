import type { SendChatContext } from "./send-command-chat.js";
import type { CreateDraftResult } from "./send-command-draft-service.js";
import { withCommandSession } from "./send-command-session.js";
import { createAnnouncementDraftLegacy, createPinDraftLegacy } from "./send-assisted-draft-legacy.js";

// Tạo nháp ghim / lời mời họp cho hai công cụ đề xuất CÓ phần phía trợ lý (đọc Google Calendar ngoài MCP): nội dung đã dựng xong ở phía trợ lý, bước ghi nháp
// đi qua công cụ lệnh của lõi (mặt `assistant_command` — mô hình không gọi được, nên nội dung do máy chủ dựng không bị mô hình chèn chữ). Không có nguồn phiên → đường cũ.

const toResult = (data: Record<string, unknown>): CreateDraftResult => ({
  reply: String(data.reply ?? ""), commandId: typeof data.command_id === "number" ? data.command_id : undefined,
});

export async function createPinDraftVia(chat: SendChatContext, input: { groups: string[]; content: string }, now: Date): Promise<CreateDraftResult> {
  const via = await withCommandSession(chat, ["send_pin_draft_create"], (call) => call("send_pin_draft_create", {
    question: chat.question, group_names: input.groups, content: input.content,
  }));
  return via ? toResult(via.value) : createPinDraftLegacy(chat, input, now);
}

export async function createAnnouncementDraftVia(chat: SendChatContext, input: { groups: string[]; body: string }, now: Date): Promise<CreateDraftResult> {
  const via = await withCommandSession(chat, ["send_draft_create"], (call) => call("send_draft_create", {
    question: chat.question, target_names: input.groups, schedule_text: "", body: input.body, with_recent_files: false, trusted_body: true,
  }));
  return via ? toResult(via.value) : createAnnouncementDraftLegacy(chat, input, now);
}
