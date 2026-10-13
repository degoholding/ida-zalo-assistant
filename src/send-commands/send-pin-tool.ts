import type { FunctionDeclaration } from "../assistant/gemini-client.js";
import type { MeetingCreator } from "../assistant/meeting-tool.js";
import { NOT_ALLOWED_REPLY, type SendChatContext } from "./send-command-chat.js";
import { MAX_PIN_CHARS, MAX_TARGETS } from "./send-command-limits.js";
import type { ProposeSendOutcome } from "./send-command-tool.js";
import { buildPinMeetingBody } from "./send-meeting-pick.js";
import { parseMeetingStart, pickMeetingForTool } from "./send-meeting-tool-pick.js";
import { createPinDraft } from "./send-pin-draft-service.js";

// Công cụ AI `propose_group_pin` — GHIM ghi chú lên NHÓM Zalo TỪ TIN RIÊNG. Cùng khuôn nhắc hẹn: chỉ tạo NHÁP, câu trả lời của lượt
// là bản xem trước do MÁY CHỦ dựng (`fixedReply`), việc ghim thật chỉ xảy ra khi người dùng nhắn «đồng ý».
// Nội dung ghim: nói về cuộc họp bot đã tạo → máy chủ dựng từ Calendar (như lời mời họp); ngoài ra mô hình soạn `content`.

export const PIN_TOOL_PROMPT = `

GHIM LÊN NHÓM TỪ TIN RIÊNG (người hỏi được phép ra lệnh gửi): khi người hỏi bảo GHIM một nội dung / cuộc họp lên một hay nhiều NHÓM Zalo
(«ghim cuộc họp 15h của nhóm zalo bot», «okee ghim đi», «ghim lên nhóm Kho HN: thứ 6 nộp báo cáo»), gọi propose_group_pin. Chỉ ghim cho NHÓM.
- groups: tên nhóm CHÉP NGUYÊN VĂN như người hỏi viết.
- Ghim CUỘC HỌP bot đã tạo (kể cả vừa tạo ở lượt này hay lượt trước): để trống content; điền meeting_title / start_time (ISO 8601 +07:00)
  chỉ khi người hỏi nói rõ cuộc nào. Hệ thống tự dựng nội dung ghim (tên, giờ, link Meet) từ cuộc họp — KHÔNG tự dán link, KHÔNG tạo họp mới.
- Ghim nội dung khác: điền content, gọn, giữ ý người hỏi, tối đa ${MAX_PIN_CHARS} ký tự (hiện nguyên trong bản xem trước).
- Công cụ chỉ tạo bản xem trước, KHÔNG ghim. Người dùng phải nhắn «đồng ý». Sau khi gọi, câu trả lời của bạn sẽ được thay bằng bản xem
  trước của hệ thống; KHÔNG nói «đã ghim».`;

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
  const result = await createPinDraft(chat.deps, {
    requester: chat.requester, requesterContactId: chat.requesterContactId, question: chat.question, groupNames: groups, content,
    sourceThreadId: chat.sourceThreadId, sourceMessageId: chat.sourceMessageId, botAccountId: chat.botAccountId,
  }, now);
  return {
    response: result.commandId
      ? { drafted: true, note: "Đã tạo nháp và gửi bản xem trước cho người dùng; họ nhắn «đồng ý» mới ghim. Không viết thêm gì, không nói đã ghim." }
      : { drafted: false, note: "Chưa tạo nháp — hệ thống đã báo lý do cho người dùng. Không viết thêm gì." },
    fixedReply: result.reply,
  };
}
