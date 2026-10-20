import type { ModelClient } from "../assistant/gemini-client.js";
import type { ReplyTone } from "../constants.js";
import type { Db } from "../db/pool.js";
import { isAgroTechnicalQuestion } from "../privacy/agro-technical.js";
import { maskPersonalData } from "../privacy/personal-data.js";
import { generateDrafts, ReplyGenerationError } from "./reply-draft-generator.js";
import { guardDraft } from "./reply-fact-guard.js";
import { formatNoTemplateReply, formatSuggestion } from "./reply-suggestion-format.js";
import { sqlReplySourceReader } from "./reply-suggestion-sql-reader.js";
import type { ReplySource, ReplySourceReader } from "./reply-suggestion-types.js";
import { pickTemplates } from "./reply-template-picker.js";

// Dịch vụ «gợi ý trả lời» (phase 10 — N2): tin gốc → mẫu ĐÃ DUYỆT → 1 lượt mô hình → kiểm sau sinh → chữ trả lời do máy chủ dựng.
// Dùng chung cho công cụ AI (phase 3) và API web (phase 7). Bot KHÔNG gửi bản nháp đi đâu.

export const HOURLY_LIMIT = 30;

export interface SuggestDeps {
  /** Dùng cho bản đọc SQL mặc định; có `reader` thì dịch vụ không chạm DB. */
  db: Db;
  /** Nguồn đọc (số lượt / tin gốc / mẫu). Bỏ trống = bản SQL của `db`; trợ lý (họ `files` bật) truyền bản đi qua MCP. */
  reader?: ReplySourceReader;
  model: ModelClient;
  /** Token của lượt hỏi — lượt gọi mô hình cộng vào đây. */
  usage?: { inputTokens: number; outputTokens: number };
  /** Cài đặt «che dữ liệu cá nhân» (SĐT / CCCD / STK) trước khi đưa mô hình. */
  maskPersonal: boolean;
  now: Date;
}

export interface SuggestInput {
  tenantId: number;
  /** Tình huống / ý người hỏi, vd «trả lời tin giá Flowertop của anh Sáu». */
  question: string;
  messageId?: number;
  toneHint?: ReplyTone;
  /** Hỏi trong nhóm: chỉ nhận tin của nhóm đó. */
  scopeGroupId?: number;
  /** Liên hệ người hỏi — có thì áp trần 30 lượt / giờ (đếm assistant_turn có suggest_replies). */
  askerContactId?: number;
  /** Mã Zalo người hỏi — tin gốc trong cuộc nhắn riêng chỉ nhận cuộc của chính họ. */
  askerUid?: string;
  /** Người hỏi được xem nhóm Mật (phase 6) — chuyển cho bộ nạp tin gốc. */
  includeConfidential?: boolean;
}

export type SuggestOutcome =
  | { header: string; drafts: string[]; templateId: number }
  /** `refusal` = chữ trả thẳng người hỏi (không có mẫu / chạm trần); `error` = lỗi cho mô hình nói lại (tin sai, nhóm Mật, mô hình hỏng). */
  | { refusal: string }
  | { error: string };

export async function suggestReplies(deps: SuggestDeps, input: SuggestInput): Promise<SuggestOutcome> {
  const reader = deps.reader ?? sqlReplySourceReader(deps.db);
  const question = input.question.trim();
  if (!question) return { error: "Thiếu request — mô tả tình huống cần trả lời." };
  if (input.askerContactId && await reader.hourlyCount(input.askerContactId, deps.now) >= HOURLY_LIMIT) {
    return { refusal: `Anh/chị đã xin gợi ý ${HOURLY_LIMIT} lần trong giờ qua — chờ một lát rồi hỏi tiếp giúp em.` };
  }

  let source: ReplySource | null = null;
  if (input.messageId !== undefined) {
    const loaded = await reader.loadSource(input.messageId, { scopeGroupId: input.scopeGroupId, askerUid: input.askerUid, maskPersonal: deps.maskPersonal, includeConfidential: input.includeConfidential });
    if ("error" in loaded) return { error: loaded.error };
    source = loaded.source;
  }
  const maskedQuestion = deps.maskPersonal ? maskPersonalData(question) : question;

  // Chỉ mẫu ĐÃ DUYỆT (repository lọc + picker lọc lại) — không ứng viên thì KHÔNG sinh.
  const approved = await reader.listApprovedTemplates(input.tenantId);
  const matchText = `${maskedQuestion}\n${source?.text ?? ""}`;
  const candidates = pickTemplates(approved, matchText);
  if (!candidates.length) return { refusal: formatNoTemplateReply(approved.map((template) => template.name)) };

  let parsed;
  try {
    parsed = await generateDrafts(
      { model: deps.model, usage: deps.usage },
      { candidates: candidates.map((item) => item.template), question: maskedQuestion, source, toneHint: input.toneHint });
  } catch (error) {
    if (error instanceof ReplyGenerationError) return { error: `Không soạn được bản nháp (${error.message}) — báo người hỏi thử lại sau.` };
    throw error;
  }
  const template = candidates.find((item) => item.template.id === parsed.templateId)?.template ?? candidates[0].template;

  // Nguồn số liệu hợp lệ = mẫu + tin gốc + ngữ cảnh + câu người hỏi. Mọi số khác trong nháp bị thay «[cần bổ sung]».
  const sources = [template.body, maskedQuestion, source?.text ?? "", ...(source?.context.map((line) => line.text) ?? [])];
  const agro = isAgroTechnicalQuestion(`${question}\n${source?.text ?? ""}`);
  const drafts = parsed.drafts.map((draft) => guardDraft(draft, sources, { agro, templateBody: template.body }));
  const formatted = formatSuggestion({ templateId: template.id, templateName: template.name, source, drafts, agro });
  return { header: formatted.header, drafts: formatted.drafts, templateId: template.id };
}
