// mcp-guard: legacy(send) — propose_meeting_announcement gọi send-command-draft-service; phase 12
import type { FunctionDeclaration } from "../assistant/gemini-client.js";
import type { MeetingCreator } from "../assistant/meeting-tool.js";
import { NOT_ALLOWED_REPLY, type SendChatContext } from "./send-command-chat.js";
import { createDraft } from "./send-command-draft-service.js";
import { MAX_TARGETS } from "./send-command-limits.js";
import type { ProposeSendOutcome } from "./send-command-tool.js";
import { buildAnnouncementBody } from "./send-meeting-pick.js";
import { parseMeetingStart, pickMeetingForTool } from "./send-meeting-tool-pick.js";

// Công cụ AI `propose_meeting_announcement` — gửi LỜI MỜI HỌP (tiêu đề, giờ, link Meet của cuộc họp BOT đã tạo) vào nhóm từ tin riêng.
// `propose_send_message` bắt nội dung nguyên văn chữ người hỏi nên link do bot tạo bị chặn (đúng thiết kế chống tiêm lệnh); đường này
// thì nội dung do MÁY CHỦ dựng từ Calendar — mô hình chỉ chọn cuộc họp (tiêu đề / giờ) và nhóm, KHÔNG truyền được nội dung.
// Sau đó đi chung đường nháp phase 9: bản xem trước là câu trả lời của lượt, «đồng ý» / «hủy» chung luồng.

export const MEETING_ANNOUNCE_TOOL_PROMPT = `

GỬI LỜI MỜI HỌP VÀO NHÓM (người hỏi được phép ra lệnh gửi): khi người hỏi bảo «gửi link họp / mời họp / gửi lên nhóm» cho cuộc họp Google Meet
bot đã tạo (kể cả vừa tạo ở lượt này hay lượt trước), gọi propose_meeting_announcement — KHÔNG dùng propose_send_message cho việc này và
KHÔNG bảo người hỏi tự dán link. Người hỏi chỉ bảo gửi cuộc vừa tạo thì KHÔNG tạo cuộc họp mới.
- groups: tên nhóm / nơi nhận CHÉP NGUYÊN VĂN như người hỏi viết; meeting_title / start_time (ISO 8601 +07:00) chỉ điền khi người hỏi
  nói rõ cuộc nào; không nói thì bỏ trống (hệ thống lấy cuộc họp người hỏi vừa tạo).
- Công cụ chỉ tạo bản xem trước, KHÔNG gửi; nội dung lời mời do hệ thống dựng. Người dùng phải nhắn «đồng ý». Sau khi gọi, câu trả lời
  của bạn sẽ được thay bằng bản xem trước; KHÔNG nói «đã gửi».`;

export const PROPOSE_MEETING_ANNOUNCEMENT_DECLARATION: FunctionDeclaration = {
  name: "propose_meeting_announcement",
  description:
    "Tạo NHÁP gửi LỜI MỜI HỌP (tiêu đề, giờ, link Google Meet của cuộc họp bot đã tạo) vào nhóm / người nội bộ. Nội dung do hệ thống dựng, " +
    "chỉ đề xuất — người hỏi phải nhắn «đồng ý» mới gửi. Dùng khi người hỏi bảo gửi link họp / mời họp lên nhóm.",
  parameters: {
    type: "object",
    properties: {
      groups: { type: "array", items: { type: "string" }, description: `Tên nhóm / nơi nhận, chép nguyên văn từ tin của người hỏi (tối đa ${MAX_TARGETS})` },
      meeting_title: { type: "string", description: "Tên cuộc họp nếu người hỏi nói rõ; bỏ trống = cuộc họp người hỏi vừa tạo" },
      start_time: { type: "string", description: "Giờ cuộc họp nếu người hỏi nói rõ, ISO 8601 có +07:00; bỏ trống = không lọc theo giờ" },
    },
    required: ["groups"],
  },
};

/** `chat` không có = không phải tin riêng thật (công cụ đã bị ẩn, đây là lớp chặn thứ hai). */
export async function runProposeMeetingAnnouncementTool(
  chat: SendChatContext | undefined, meetings: MeetingCreator | undefined, args: Record<string, unknown>, now: Date,
): Promise<ProposeSendOutcome> {
  if (!chat) return { response: { error: "Công cụ này chỉ dùng được trong tin riêng, với người được phép ra lệnh gửi." } };
  if (!chat.requester) return { response: { error: NOT_ALLOWED_REPLY }, fixedReply: NOT_ALLOWED_REPLY };
  const groups = Array.isArray(args.groups) ? args.groups.filter((item): item is string => typeof item === "string") : [];
  if (!groups.length) return { response: { error: "Thiếu nơi nhận (groups) — hỏi lại người dùng gửi lời mời vào nhóm nào." } };
  const start = parseMeetingStart(args);
  if ("error" in start) return { response: start };
  const picked = await pickMeetingForTool(meetings, chat.requester.uid, args, start.startMs, now, "gửi");
  if ("outcome" in picked) return picked.outcome;

  // Nội dung do MÁY CHỦ dựng (trustedBody) — args không có đường nào đưa chữ vào body
  const result = await createDraft(chat.deps, {
    requester: chat.requester, requesterContactId: chat.requesterContactId, question: chat.question, targetNames: groups,
    scheduleText: "", body: buildAnnouncementBody(picked.meeting), trustedBody: true, withRecentFiles: false,
    sourceThreadId: chat.sourceThreadId, sourceMessageId: chat.sourceMessageId, botAccountId: chat.botAccountId,
  }, now);
  return {
    response: result.commandId
      ? { drafted: true, note: "Đã tạo nháp lời mời họp và gửi bản xem trước cho người dùng; họ nhắn «đồng ý» mới gửi. Không viết thêm gì, không nói đã gửi." }
      : { drafted: false, note: "Chưa tạo nháp — hệ thống đã báo lý do cho người dùng. Không viết thêm gì." },
    fixedReply: result.reply,
  };
}
