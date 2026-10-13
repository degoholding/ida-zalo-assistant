import type { FunctionDeclaration } from "../assistant/gemini-client.js";
import { ReplyTone } from "../constants.js";
import { suggestReplies, type SuggestDeps } from "./reply-suggestion-service.js";

// Công cụ AI `suggest_replies` (phase 10 — N2). Phase 3 gắn vào `runTool`: gọi `runSuggestRepliesTool`, nếu có `reply` thì đặt
// `context.fixedReply = reply.header` và gửi từng `reply.drafts[i]` thành một tin riêng; chữ của mô hình chính bị bỏ.

export const SUGGEST_REPLIES_DECLARATION: FunctionDeclaration = {
  name: "suggest_replies",
  description:
    "GỢI Ý TRẢ LỜI: soạn 2–3 bản nháp (lịch sự / thân thiện / ngắn gọn) để NHÂN VIÊN trả lời một tin khách / đại lý, theo mẫu ĐÃ DUYỆT của công ty. " +
    "Dùng khi người hỏi nói «gợi ý trả lời tin…», «soạn giúp câu trả lời cho…», «nên trả lời thế nào với…». Muốn trả lời đúng một tin cụ thể thì " +
    "tìm tin trước bằng search_messages rồi truyền message_id. Công cụ KHÔNG gửi gì đi đâu — chỉ trả bản nháp để người hỏi tự chép. " +
    "Kết quả hiển thị do hệ thống dựng sẵn: sau khi gọi KHÔNG viết lại, KHÔNG tóm tắt, KHÔNG tự thêm bản nháp.",
  parameters: {
    type: "object",
    properties: {
      request: { type: "string", description: "Tình huống / ý người hỏi, vd «trả lời tin hỏi giá Flowertop của anh Sáu»" },
      message_id: { type: "integer", description: "Id tin cần trả lời (từ search_messages), bỏ trống nếu không có tin cụ thể" },
      tone: { type: "string", enum: ["formal", "friendly", "brief"], description: "Văn phong ưu tiên (tùy chọn)" },
    },
    required: ["request"],
  },
};

export const SUGGEST_REPLIES_PROMPT = `GỢI Ý TRẢ LỜI (suggest_replies): người hỏi xin bản nháp để trả lời khách / đại lý → tìm tin gốc bằng search_messages (nếu nhắc tới một tin), rồi gọi suggest_replies MỘT lần.
- Hệ thống tự gửi bản nháp thành từng tin riêng; bạn KHÔNG tự soạn, KHÔNG viết lại, KHÔNG gửi gì thêm.
- Bot không gửi bản nháp cho khách; người hỏi tự chép và gửi bằng Zalo của mình.
- Công cụ báo lỗi / từ chối (không có mẫu đã duyệt, tin nhóm Mật…) → nói lại đúng lý do đó, không soạn thay.`;

const TONE_ARGS: Record<string, ReplyTone> = { formal: ReplyTone.Formal, friendly: ReplyTone.Friendly, brief: ReplyTone.Brief };

export interface SuggestToolContext extends SuggestDeps {
  tenantId: number;
  scopeGroupId?: number;
  askerContactId?: number;
  askerUid?: string;
}

export interface SuggestToolOutcome {
  /** Trả cho mô hình (kết quả công cụ). */
  response: Record<string, unknown>;
  /** Chữ do máy chủ dựng: `header` = fixedReply; `drafts` = từng tin gửi riêng (rỗng khi từ chối). */
  reply?: { header: string; drafts: string[] };
}

export async function runSuggestRepliesTool(context: SuggestToolContext, args: Record<string, unknown>): Promise<SuggestToolOutcome> {
  const request = typeof args.request === "string" ? args.request : "";
  const rawId = args.message_id;
  const messageId = rawId === undefined || rawId === null || rawId === "" ? undefined : Number(rawId);
  if (messageId !== undefined && !Number.isSafeInteger(messageId)) return { response: { error: "message_id phải là số nguyên (id từ search_messages)." } };
  const outcome = await suggestReplies(context, {
    tenantId: context.tenantId, question: request, messageId, toneHint: TONE_ARGS[String(args.tone ?? "").toLowerCase()],
    scopeGroupId: context.scopeGroupId, askerContactId: context.askerContactId, askerUid: context.askerUid,
  });
  if ("error" in outcome) return { response: { error: outcome.error } };
  if ("refusal" in outcome) {
    return { response: { refused: true, note: "Hệ thống đã dựng sẵn câu trả lời gửi người hỏi — không viết lại." }, reply: { header: outcome.refusal, drafts: [] } };
  }
  return {
    response: { ok: true, template_id: outcome.templateId, draft_count: outcome.drafts.length, note: "Hệ thống đã dựng sẵn câu trả lời và các bản nháp — không viết lại." },
    reply: { header: outcome.header, drafts: outcome.drafts },
  };
}
