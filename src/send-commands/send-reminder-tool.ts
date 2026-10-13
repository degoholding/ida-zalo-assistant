import type { FunctionDeclaration } from "../assistant/gemini-client.js";
import { NOT_ALLOWED_REPLY, type SendChatContext } from "./send-command-chat.js";
import { MAX_REMINDER_TITLE_CHARS, MAX_TARGETS } from "./send-command-limits.js";
import type { ProposeSendOutcome } from "./send-command-tool.js";
import { createReminderDraft } from "./send-reminder-draft-service.js";

// Công cụ AI `propose_group_reminder` — tạo NHẮC HẸN Zalo cho nhóm TỪ TIN RIÊNG. Khuôn y hệt `propose_send_message`: chỉ tạo NHÁP,
// câu trả lời của lượt là bản xem trước do MÁY CHỦ dựng (`fixedReply`), việc tạo thật chỉ xảy ra khi người dùng nhắn «đồng ý».

export const REMINDER_TOOL_PROMPT = `

NHẮC HẸN CHO NHÓM TỪ TIN RIÊNG (người hỏi được phép ra lệnh): khi người hỏi bảo tạo / đặt NHẮC HẸN trong một hay nhiều NHÓM Zalo
(«tạo nhắc hẹn họp 11h trong nhóm zalo bot»), gọi propose_group_reminder. Nhắc hẹn chỉ tạo cho NHÓM, không cho từng người.
- groups: tên nhóm CHÉP NGUYÊN VĂN như người hỏi viết; title: nội dung nhắc, ngắn gọn (tối đa ${MAX_REMINDER_TITLE_CHARS} ký tự, được tóm
  gọn nhưng không đổi ý); start_time: giờ nhắc dạng ISO 8601 có +07:00; repeat: none / daily / weekly / monthly (mặc định none).
- Thiếu giờ hoặc nội dung nhắc thì HỎI LẠI, không đoán. Vừa tạo cuộc họp Meet xong mà người hỏi chỉ bảo «tạo nhắc hẹn trong nhóm» thì
  dùng đúng tiêu đề + giờ của cuộc họp đó cho nhắc hẹn, KHÔNG tạo thêm cuộc họp.
- Công cụ chỉ tạo bản xem trước, KHÔNG tạo nhắc hẹn. Bạn không bao giờ tự xác nhận — người dùng phải nhắn «đồng ý». Sau khi gọi, câu
  trả lời của bạn sẽ được thay bằng bản xem trước của hệ thống; KHÔNG nói «đã tạo nhắc hẹn».`;
// Bình chọn / bỏ ghim / hủy nhắc hẹn từ tin riêng → «gọi em trong nhóm đó»: nằm ở no-fake-action-prompt.ts (luôn ghép ở tin riêng).

export const PROPOSE_REMINDER_DECLARATION: FunctionDeclaration = {
  name: "propose_group_reminder",
  description:
    "Tạo NHÁP nhắc hẹn Zalo cho một hay nhiều NHÓM nội bộ (từ tin riêng). Chỉ đề xuất — hệ thống tự dựng bản xem trước và người hỏi " +
    "phải nhắn «đồng ý» mới tạo. Chỉ cho nhóm, không cho từng người.",
  parameters: {
    type: "object",
    properties: {
      groups: { type: "array", items: { type: "string" }, description: `Tên nhóm, chép nguyên văn từ tin của người hỏi (tối đa ${MAX_TARGETS})` },
      title: { type: "string", description: `Nội dung nhắc, ngắn gọn, tối đa ${MAX_REMINDER_TITLE_CHARS} ký tự, vd 'Họp giao ban tuần'` },
      start_time: { type: "string", description: "Thời điểm nhắc, ISO 8601 có +07:00, vd 2026-10-13T08:00:00+07:00" },
      repeat: { type: "string", enum: ["none", "daily", "weekly", "monthly"], description: "Lặp lại; mặc định none" },
    },
    required: ["groups", "title", "start_time"],
  },
};

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
