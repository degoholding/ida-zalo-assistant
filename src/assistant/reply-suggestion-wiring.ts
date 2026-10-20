// mcp-guard: legacy(files) — kiểm tin gốc đọc được bằng visibility-guards; phase 7 (nguồn gợi ý trả lời)
import { DataAccessError } from "../data-access/data-access-errors.js";
import { assertMessageReadable } from "../data-access/visibility-guards.js";
import { runSuggestRepliesTool } from "../reply-suggestions/reply-suggestion-tool.js";
import { relaxConfidential } from "./infra/asker-access.js";
import type { ToolContext } from "./tools.js";

// Nối công cụ `suggest_replies` (phase 10) vào trợ lý — chỉ tin riêng. Bản nháp đi thành từng tin Zalo riêng qua `followUps`;
// bot KHÔNG gửi bản nháp cho ai khác. Phase 7 (họ `files` / nguồn gợi ý) sửa tệp này.

/** Lời nhắc bổ sung (ngoài SUGGEST_REPLIES_PROMPT của lõi N2): ép dùng công cụ, không tự viết nháp. */
export const SUGGEST_REPLIES_MANDATORY_PROMPT = `
- Người hỏi nhờ soạn / gợi ý câu trả lời cho khách, đại lý, đồng nghiệp → BẮT BUỘC gọi suggest_replies, KHÔNG tự viết bản nháp.
  Có nhắc tin cụ thể («tin giá Flowertop của anh Sáu») → search_messages trước, lấy message_id đúng tin rồi gọi suggest_replies MỘT lần.`;

/**
 * `suggest_replies`: một lượt chỉ một câu trả lời dựng sẵn. Thành công / từ chối → `fixedReply` = phần đầu, `followUps` = từng
 * bản nháp (mỗi bản một tin); lỗi → chỉ trả `error` để mô hình nói lại lý do.
 */
export async function runSuggestRepliesInTurn(context: ToolContext, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (context.scopeGroupId !== undefined || !context.replySuggestion) return { error: "Gợi ý trả lời chỉ dùng được khi nhắn riêng cho bot." };
  if (context.fixedReply !== undefined) return { error: "Lượt này đã có câu trả lời dựng sẵn — không gọi thêm." };
  // Tin gốc phải nằm trong phạm vi người hỏi (cuộc riêng của người khác / nhóm ngoài phạm vi = như không có); chặn Mật do bộ nạp tin lo
  const messageId = Number(args.message_id);
  if (args.message_id !== undefined && args.message_id !== null && args.message_id !== "" && Number.isSafeInteger(messageId) && messageId > 0) {
    try {
      await assertMessageReadable(relaxConfidential(context.access), messageId);
    } catch (error) {
      if (error instanceof DataAccessError && error.code === "not_found") return { error: "Không tìm thấy tin này (hoặc đã bị thu hồi)." };
      throw error;
    }
  }
  const outcome = await runSuggestRepliesTool({ ...context.replySuggestion, includeConfidential: context.access.includeConfidential }, args);
  if (outcome.reply) {
    context.fixedReply = outcome.reply.header;
    context.followUps = outcome.reply.drafts;
  }
  return outcome.response;
}
