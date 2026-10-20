import { z } from "zod/v4";
import { countSuggestionsLastHour } from "../../reply-suggestions/reply-suggestion-sql-reader.js";
import { loadReplySource } from "../../reply-suggestions/reply-source-loader.js";
import { listApprovedTemplates } from "../../reply-suggestions/reply-template-repository.js";
import { canUse } from "../data-access-context.js";
import { DataAccessError, translateDbError } from "../data-access-errors.js";
import { assertMessageReadable } from "../visibility-guards.js";
import type { ToolDefinition } from "../tool-definition.js";

// reply_sources (mặt LỆNH): phần ĐỌC của `suggest_replies` — số lượt xin gợi ý trong giờ, tin gốc cần trả lời + ≤ 5 tin ngay trước, và mẫu tin ĐÃ DUYỆT.
// Phần sinh bản nháp bằng AI là tác động ngoài, nằm ngoài MCP (phía trợ lý). Phạm vi tin gốc: cuộc người hỏi thấy được (tin ngoài phạm vi / cuộc riêng của người khác
// = «không tìm thấy»), nhóm Mật theo cờ, hỏi trong nhóm chỉ tin của nhóm đó. Chữ tin KHÔNG che ở đây (mặt lệnh không che); phía trợ lý che theo cài đặt trước khi đưa mô hình.

const NOT_FOUND = "Không tìm thấy tin này (hoặc đã bị thu hồi).";

const inputSchema = z.object({ message_id: z.number().int().optional() });
type ReplySourcesInput = z.infer<typeof inputSchema>;

const lineSchema = z.object({ sender_name: z.string(), sent_at: z.string(), text: z.string() });
const templateSchema = z.object({
  id: z.number(), tenant_id: z.number(), name: z.string(), situation: z.string(), keywords: z.array(z.string()), body: z.string(), tone: z.number(), status: z.number(),
  author_user_id: z.number().nullable(), author_name: z.string(), reviewer_user_id: z.number().nullable(), reviewer_name: z.string(), review_note: z.string(),
  submitted_at: z.string().nullable(), reviewed_at: z.string().nullable(), created_at: z.string(), updated_at: z.string(),
});

const outputSchema = z.object({
  hourly_count: z.number(),
  /** Tin gốc ngoài phạm vi người hỏi (kiểm TRƯỚC mọi bước khác — đúng thứ tự của đường cũ). */
  precheck_error: z.string().nullable(),
  source: z.object({ message_id: z.number(), group_name: z.string(), sender_name: z.string(), sent_at: z.string(), text: z.string(), context: z.array(lineSchema) }).nullable(),
  /** Lý do không dùng được tin gốc (Mật, cuộc riêng người khác, không có chữ…) — câu như loader cũ. */
  source_error: z.string().nullable(),
  templates: z.array(templateSchema),
});
type ReplySourcesOutput = z.infer<typeof outputSchema>;

const iso = (value: Date | null): string | null => (value ? new Date(value).toISOString() : null);

export const replySourcesTool: ToolDefinition<ReplySourcesInput, ReplySourcesOutput> = {
  name: "reply_sources",
  title: "Nguồn đọc cho gợi ý trả lời (tin gốc, ngữ cảnh, mẫu đã duyệt)",
  description: "Tin gốc + ngữ cảnh + mẫu tin đã duyệt + số lượt gợi ý trong giờ cho công cụ gợi ý trả lời. Chỉ lệnh nội bộ của trợ lý.",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_command"],
  family: "files",
  assistantErrorShape: "string",
  // Gợi ý trả lời chỉ ở tin riêng (đường cũ chặn trong nhóm) và cần người nhắn bot có danh tính liên hệ
  available: (ctx) => ctx.groupScopeId === undefined && ctx.contactActor != null && canUse(ctx, "conversation", "read"),
  async handler(ctx, input) {
    const actor = ctx.contactActor;
    if (!actor) throw new DataAccessError("forbidden", "Thiếu danh tính người hỏi.");
    let hourly: number;
    let precheck: string | null = null;
    let source: ReplySourcesOutput["source"] = null;
    let sourceError: string | null = null;
    let templates: Awaited<ReturnType<typeof listApprovedTemplates>>;
    try {
      hourly = await countSuggestionsLastHour(ctx.db, actor.contactId, ctx.now);
      const messageId = input.message_id;
      if (messageId !== undefined) {
        if (messageId > 0) {
          try {
            // Cho qua Mật để loader báo đúng câu «tin thuộc nhóm Mật» (phân biệt với «không tìm thấy»)
            await assertMessageReadable({ ...ctx, includeConfidential: true }, messageId);
          } catch (error) {
            if (error instanceof DataAccessError && error.code === "not_found") precheck = NOT_FOUND;
            else throw error;
          }
        }
        if (precheck === null) {
          const loaded = await loadReplySource(ctx.db, messageId, { scopeGroupId: ctx.groupScopeId, askerUid: actor.uid, maskPersonal: false, includeConfidential: ctx.includeConfidential });
          if ("error" in loaded) sourceError = loaded.error;
          else {
            const found = loaded.source;
            source = {
              message_id: found.messageId, group_name: found.groupName, sender_name: found.senderName, sent_at: found.sentAt.toISOString(), text: found.text,
              context: found.context.map((line) => ({ sender_name: line.senderName, sent_at: line.sentAt.toISOString(), text: line.text })),
            };
          }
        }
      }
      templates = await listApprovedTemplates(ctx.db, ctx.principal.tenantId);
    } catch (error) {
      return translateDbError(error);
    }
    const structured: ReplySourcesOutput = {
      hourly_count: hourly, precheck_error: precheck, source, source_error: sourceError,
      templates: templates.map((template) => ({
        id: template.id, tenant_id: template.tenantId, name: template.name, situation: template.situation, keywords: template.keywords, body: template.body,
        tone: template.tone, status: template.status, author_user_id: template.authorUserId, author_name: template.authorName,
        reviewer_user_id: template.reviewerUserId, reviewer_name: template.reviewerName, review_note: template.reviewNote,
        submitted_at: iso(template.submittedAt), reviewed_at: iso(template.reviewedAt), created_at: iso(template.createdAt) ?? "", updated_at: iso(template.updatedAt) ?? "",
      })),
    };
    return { structured, summary: `Nguồn gợi ý: ${structured.templates.length} mẫu${source ? ", có tin gốc" : ""}.`, rowCount: structured.templates.length, entity: "reply_templates" };
  },
};
