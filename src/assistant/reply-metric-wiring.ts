import { runQueryMetricsTool } from "../metrics/metric-query-tool.js";
import { runSuggestRepliesTool } from "../reply-suggestions/reply-suggestion-tool.js";
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
  const outcome = await runSuggestRepliesTool(context.replySuggestion, args);
  if (outcome.reply) {
    context.fixedReply = outcome.reply.header;
    context.followUps = outcome.reply.drafts;
  }
  return outcome.response;
}

/** `query_metrics`: chỉ tin riêng. */
export async function runQueryMetricsInTurn(context: ToolContext, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (context.scopeGroupId !== undefined) return { error: "Số liệu chỉ hỏi được khi nhắn riêng cho bot." };
  return runQueryMetricsTool({ db: context.db, now: context.now }, args);
}
