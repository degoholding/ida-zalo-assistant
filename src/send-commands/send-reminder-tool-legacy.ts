import type { SendChatContext } from "./send-command-chat.js";
import { NOT_ALLOWED_REPLY } from "./send-command-replies.js";
import type { ProposeSendOutcome } from "./send-command-tool-legacy.js";
import { createReminderDraft } from "./send-reminder-draft-service.js";

// Đường CŨ của công cụ AI `propose_group_reminder` (họ `send` tắt hoặc phiên MCP không liệt kê công cụ): chỉ tạo NHÁP, câu trả lời của lượt
// là bản xem trước do MÁY CHỦ dựng (`fixedReply`). Họ bật thì công cụ lõi `propose_group_reminder` (data-access/send/) chạy thay; gỡ ở phase 13.

/** `chat` không có = không phải tin riêng Zalo thật (tool đã được ẩn, đây là lớp chặn thứ hai). */
export async function runProposeReminderTool(chat: SendChatContext | undefined, args: Record<string, unknown>, now: Date): Promise<ProposeSendOutcome> {
  if (!chat) return { response: { error: "Công cụ này chỉ dùng được trong tin riêng, với người được phép ra lệnh." } };
  if (!chat.requester) return { response: { error: NOT_ALLOWED_REPLY }, fixedReply: NOT_ALLOWED_REPLY };
  const groups = Array.isArray(args.groups) ? args.groups.filter((item): item is string => typeof item === "string") : [];
  const title = typeof args.title === "string" ? args.title : "";
  const startTime = typeof args.start_time === "string" ? args.start_time : "";
  if (!groups.length || !title.trim() || !startTime.trim()) {
    return { response: { error: "Thiếu nhóm (groups), nội dung nhắc (title) hoặc giờ nhắc (start_time) — hỏi lại người dùng." } };
  }
  const result = await createReminderDraft(chat.deps, {
    requester: chat.requester, requesterContactId: chat.requesterContactId, question: chat.question, groupNames: groups, title, startTime,
    repeat: typeof args.repeat === "string" ? args.repeat : "", sourceThreadId: chat.sourceThreadId, sourceMessageId: chat.sourceMessageId,
    botAccountId: chat.botAccountId,
  }, now);
  return {
    response: result.commandId
      ? { drafted: true, note: "Đã tạo nháp và gửi bản xem trước cho người dùng; họ nhắn «đồng ý» mới tạo nhắc hẹn. Không viết thêm gì, không nói đã tạo." }
      : { drafted: false, note: "Chưa tạo nháp — hệ thống đã báo lý do cho người dùng. Không viết thêm gì." },
    fixedReply: result.reply,
  };
}
