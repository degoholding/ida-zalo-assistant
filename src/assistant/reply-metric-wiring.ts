import { can } from "../auth/principal.js";
import { DataAccessError } from "../data-access/data-access-errors.js";
import { assertMessageReadable } from "../data-access/visibility-guards.js";
import { runQueryMetricsTool } from "../metrics/metric-query-tool.js";
import { runSuggestRepliesTool } from "../reply-suggestions/reply-suggestion-tool.js";
import { relaxConfidential } from "./asker-access.js";
import type { ToolContext } from "./tools.js";

// Nối hai công cụ phase 10 (suggest_replies, query_metrics) vào trợ lý — chỉ tin riêng. Tách khỏi tools.ts / assistant-service.ts
// (đã quá 200 dòng). Bản nháp đi thành từng tin Zalo riêng qua `followUps`; bot KHÔNG gửi bản nháp cho ai khác.

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

/** `query_metrics`: chỉ tin riêng. */
export async function runQueryMetricsInTurn(context: ToolContext, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (context.scopeGroupId !== undefined) return { error: "Số liệu chỉ hỏi được khi nhắn riêng cho bot." };
  // Quyền «Số liệu» theo vai trò tài khoản web (Quản lý / Quản trị). Người có vai trò Danh bạ chưa có tài khoản giữ như trước (principal suy ra
  // = Quản lý); người chỉ là người nhận / tài khoản đã tắt không có quyền này.
  if (!can(context.access.principal, "metric", "read")) return { error: "Anh/chị chưa được cấp quyền xem số liệu qua bot." };
  return runQueryMetricsTool({ db: context.db, now: context.now }, args);
}
