import type { FunctionDeclaration } from "../assistant/gemini-client.js";
import type { MeetingCreator } from "../assistant/meeting-tool.js";
import { createPinDraftVia } from "./send-assisted-draft.js";
import type { SendChatContext } from "./send-command-chat.js";
import { MAX_PIN_CHARS, MAX_TARGETS } from "./send-command-limits.js";
import { NOT_ALLOWED_REPLY } from "./send-command-replies.js";
import type { ProposeSendOutcome } from "./send-command-tool.js";
import { buildPinMeetingBody } from "./send-meeting-pick.js";
import { parseMeetingStart, pickMeetingForTool } from "./send-meeting-tool-pick.js";
export { PIN_TOOL_PROMPT } from "./send-tool-prompts.js";

// Công cụ AI `propose_group_pin` — GHIM ghi chú lên NHÓM Zalo TỪ TIN RIÊNG. Cùng khuôn nhắc hẹn: chỉ tạo NHÁP, câu trả lời của lượt
// là bản xem trước do MÁY CHỦ dựng (`fixedReply`), việc ghim thật chỉ xảy ra khi người dùng nhắn «đồng ý».
// Nội dung ghim: nói về cuộc họp bot đã tạo → máy chủ dựng từ Calendar (như lời mời họp); ngoài ra mô hình soạn `content`.

export const PROPOSE_PIN_DECLARATION: FunctionDeclaration = {
  name: "propose_group_pin",
  description:
    "Tạo NHÁP ghim ghi chú lên một hay nhiều NHÓM nội bộ (từ tin riêng). Chỉ đề xuất — hệ thống tự dựng bản xem trước và người hỏi phải " +
    "nhắn «đồng ý» mới ghim. Chỉ cho nhóm. Ghim cuộc họp bot đã tạo thì bỏ trống content (hệ thống dựng từ cuộc họp).",
  parameters: {
    type: "object",
    properties: {
      groups: { type: "array", items: { type: "string" }, description: `Tên nhóm, chép nguyên văn từ tin của người hỏi (tối đa ${MAX_TARGETS})` },
      content: { type: "string", description: `Nội dung ghim (tối đa ${MAX_PIN_CHARS} ký tự); bỏ trống khi ghim cuộc họp bot đã tạo` },
      meeting_title: { type: "string", description: "Tên cuộc họp nếu người hỏi nói rõ; bỏ trống = cuộc họp người hỏi vừa tạo" },
      start_time: { type: "string", description: "Giờ cuộc họp nếu người hỏi nói rõ, ISO 8601 có +07:00; bỏ trống = không lọc theo giờ" },
    },
    required: ["groups"],
  },
};

/** `chat` không có = không phải tin riêng Zalo thật (công cụ đã bị ẩn, đây là lớp chặn thứ hai). */
export async function runProposePinTool(
  chat: SendChatContext | undefined, meetings: MeetingCreator | undefined, args: Record<string, unknown>, now: Date,
): Promise<ProposeSendOutcome> {
  if (!chat) return { response: { error: "Công cụ này chỉ dùng được trong tin riêng, với người được phép ra lệnh." } };
  if (!chat.requester) return { response: { error: NOT_ALLOWED_REPLY }, fixedReply: NOT_ALLOWED_REPLY };
  const groups = Array.isArray(args.groups) ? args.groups.filter((item): item is string => typeof item === "string") : [];
  if (!groups.length) return { response: { error: "Thiếu nhóm (groups) — hỏi lại người dùng ghim lên nhóm nào." } };
  const start = parseMeetingStart(args);
  if ("error" in start) return { response: start };

  const rawContent = typeof args.content === "string" ? args.content : "";
  const wantsMeeting = !rawContent.trim() || start.startMs !== null || (typeof args.meeting_title === "string" && Boolean(args.meeting_title.trim()));
  let content = rawContent;
  if (wantsMeeting) {
    // Nội dung do MÁY CHỦ dựng từ cuộc họp — chữ mô hình truyền vào `content` bị bỏ qua ở đường này
    const picked = await pickMeetingForTool(meetings, chat.requester.uid, args, start.startMs, now, "ghim");
    if ("outcome" in picked) return picked.outcome;
    content = buildPinMeetingBody(picked.meeting);
  }
  // Nội dung đã dựng xong ở đây (Calendar / mô hình soạn); bước ghi nháp qua công cụ lõi `send_pin_draft_create` khi họ `send` bật
  const result = await createPinDraftVia(chat, { groups, content }, now);
  return {
    response: result.commandId
      ? { drafted: true, note: "Đã tạo nháp và gửi bản xem trước cho người dùng; họ nhắn «đồng ý» mới ghim. Không viết thêm gì, không nói đã ghim." }
      : { drafted: false, note: "Chưa tạo nháp — hệ thống đã báo lý do cho người dùng. Không viết thêm gì." },
    fixedReply: result.reply,
  };
}
