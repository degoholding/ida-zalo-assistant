// mcp-guard: legacy(send) — đường cũ của propose_send_message (họ `send` tắt hoặc phiên MCP không liệt kê công cụ); gỡ ở phase 13
import type { SendChatContext } from "./send-command-chat.js";
import { createDraft } from "./send-command-draft-service.js";
import { NOT_ALLOWED_REPLY } from "./send-command-replies.js";

// Công cụ AI `propose_send_message` (phase 9) — cho câu ra lệnh gửi tin mà parser lệnh gõ không khớp («nhờ em nhắc nhóm kho
// chiều nay họp nhé»). CHỈ ĐỀ XUẤT: tạo NHÁP rồi câu trả lời của lượt là bản xem trước do MÁY CHỦ dựng (`fixedReply`), mô hình
// không viết lại được. Nội dung + tên nơi nhận phải nguyên văn trong tin của người hỏi (createDraft → assertVerbatim); việc
// xác nhận chỉ qua lệnh gõ «đồng ý» — mô hình không có công cụ xác nhận.

export interface ProposeSendOutcome {
  /** Phản hồi cho mô hình */
  response: Record<string, unknown>;
  /** Có = câu trả lời CỦA CẢ LƯỢT phải là chữ này (bản xem trước / lý do từ chối do máy chủ dựng) */
  fixedReply?: string;
}

/** `chat` không có = người hỏi không đủ quyền / không phải tin riêng → báo lỗi (tool đã được ẩn, đây là lớp chặn thứ hai). */
export async function runProposeSendTool(chat: SendChatContext | undefined, args: Record<string, unknown>, now: Date): Promise<ProposeSendOutcome> {
  if (!chat) return { response: { error: "Công cụ này chỉ dùng được trong tin riêng, với người được phép ra lệnh gửi." } };
  if (!chat.requester) return { response: { error: NOT_ALLOWED_REPLY }, fixedReply: NOT_ALLOWED_REPLY };
  const targets = Array.isArray(args.targets) ? args.targets.filter((item): item is string => typeof item === "string") : [];
  const content = typeof args.content === "string" ? args.content : "";
  if (!targets.length || (!content.trim() && args.with_recent_files !== true)) {
    return { response: { error: "Thiếu nơi nhận (targets) hoặc nội dung (content)." } };
  }
  const result = await createDraft(chat.deps, {
    requester: chat.requester, requesterContactId: chat.requesterContactId, question: chat.question, targetNames: targets,
    scheduleText: typeof args.schedule === "string" ? args.schedule : "", body: content, withRecentFiles: args.with_recent_files === true,
    sourceThreadId: chat.sourceThreadId, sourceMessageId: chat.sourceMessageId, botAccountId: chat.botAccountId,
  }, now);
  return {
    response: result.commandId
      ? { drafted: true, note: "Đã tạo nháp và gửi bản xem trước cho người dùng; họ nhắn «đồng ý» mới gửi. Không viết thêm gì." }
      : { drafted: false, note: "Chưa tạo nháp — hệ thống đã báo lý do cho người dùng. Không viết thêm gì." },
    fixedReply: result.reply,
  };
}
