import { runSuggestRepliesTool } from "../reply-suggestions/reply-suggestion-tool.js";
import { filesMcpFor } from "./files-command-call.js";
import { replySourcesMcpReader } from "./reply-sources-mcp-reader.js";
import { replySourcePrecheckLegacy } from "./reply-suggestion-wiring-legacy.js";
import type { ToolContext } from "./tools.js";

// Nối công cụ `suggest_replies` (phase 10) vào trợ lý — chỉ tin riêng. Bản nháp đi thành từng tin Zalo riêng qua `followUps`;
// bot KHÔNG gửi bản nháp cho ai khác. Họ `files` bật: phần ĐỌC (tin gốc + ngữ cảnh + mẫu đã duyệt + số lượt trong giờ) qua công cụ lệnh `reply_sources`;
// sinh bản nháp bằng AI là tác động ngoài nên ở lại phía trợ lý. Họ tắt: SQL cũ (`reply-suggestion-wiring-legacy.ts` + bản đọc SQL của dịch vụ).

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
  const messageId = Number(args.message_id);
  const given = args.message_id !== undefined && args.message_id !== null && args.message_id !== "" && Number.isSafeInteger(messageId);
  // Kiểm phạm vi tin gốc trước mọi bước khác chỉ khi id dương (id ≤ 0 để bộ nạp tin báo «không hợp lệ» như đường cũ)
  const hasMessageId = given && messageId > 0;
  const suggest = { ...context.replySuggestion, includeConfidential: context.access.includeConfidential };
  const mcp = await filesMcpFor(context.mcp, "reply_sources");
  if (mcp) {
    const handle = replySourcesMcpReader(mcp, given ? messageId : undefined, suggest.maskPersonal);
    // Tin gốc phải nằm trong phạm vi người hỏi: lõi (reply_sources) kiểm trước mọi bước khác, như đường cũ
    if (hasMessageId) {
      const bundle = await handle.fetch();
      if ("error" in bundle) return { error: bundle.error };
      if (bundle.precheckError) return { error: bundle.precheckError };
    }
    suggest.reader = handle.reader;
  } else if (hasMessageId) {
    const refused = await replySourcePrecheckLegacy(context.access, messageId);
    if (refused) return { error: refused };
  }
  const outcome = await runSuggestRepliesTool(suggest, args);
  if (outcome.reply) {
    context.fixedReply = outcome.reply.header;
    context.followUps = outcome.reply.drafts;
  }
  return outcome.response;
}
