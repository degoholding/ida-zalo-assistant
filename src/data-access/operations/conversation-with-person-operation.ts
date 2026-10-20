import { z } from "zod/v4";
import { ConversationType } from "../../constants.js";
import { MAX_MESSAGES, MESSAGE_SELECT, formatLines, formatVn, parseTime, type MessageLineRow } from "../../assistant/message-line-format.js";
import { canUse } from "../data-access-context.js";
import { DataAccessError, translateDbError } from "../data-access-errors.js";
import { askerUidOf } from "../reads/message-search-core.js";
import { QUERY_TIME_HINT } from "../query-compiler.js";
import { threadVisibilitySql } from "../visibility-guards.js";
import { UNTRUSTED_NOTICE, type ToolDefinition } from "../tool-definition.js";

// get_conversation_with_person: những gì đã trao đổi với MỘT người trong khoảng thời gian — tin người đó gửi, tin nhắc tên người đó, tin của người
// hỏi trong các nhóm có người đó, và (nếu được thấy) cuộc riêng giữa người đó với bot. Trả CHỮ theo khuôn dòng `[giờ] (nhóm) Người: nội dung`.
// Phạm vi KHÔNG tự viết ở đây: `threadVisibilitySql` của ctx. Với trợ lý (`ownDirectThreadsOnly`) cuộc riêng người khác bị loại — vá H1: hỏi về
// người khác thì chỉ có tin trong nhóm; cuộc riêng chỉ hiện khi đó là cuộc riêng của chính người hỏi.
// Khai báo cho mô hình GIỮ NGUYÊN câu chữ cũ (test khớp khai báo); hỏi trong nhóm thì công cụ ẩn.

const DEFAULT_DAYS = 7;
const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

const inputSchema = z.object({
  person_uid: z.string().describe("uid lấy từ find_people"),
  from: z.string().describe("Bắt đầu, ISO 8601 có múi giờ"),
  to: z.string().describe("Kết thúc, ISO 8601 có múi giờ"),
  include_me: z.boolean().optional().describe("Có lấy cả tin của người hỏi không (mặc định có)"),
});
type ConversationInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  from: z.string(), to: z.string(), message_count: z.number(), truncated: z.boolean(), messages: z.string(),
});
type ConversationOutput = z.infer<typeof outputSchema>;

/** Chèn gợi ý MAX_EXECUTION_TIME ngay sau SELECT đầu tiên của khuôn chọn tin dùng chung. */
function withTimeHint(select: string): string {
  return select.replace(/^\s*SELECT\b/i, `SELECT ${QUERY_TIME_HINT}`);
}

export const conversationWithPersonTool: ToolDefinition<ConversationInput, ConversationOutput> = {
  name: "get_conversation_with_person",
  title: "Trao đổi với một người",
  description:
    "Lấy những gì đã trao đổi với MỘT người trong khoảng thời gian: tin người đó gửi, tin nhắc tên người đó, " +
    "tin của người hỏi trong các nhóm có người đó, và tin riêng giữa người đó với bot. Dùng cho câu 'tôi đã bàn gì với chị A'.",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_model"],
  family: "reads",
  assistantErrorShape: "string",
  available: (ctx) => ctx.groupScopeId === undefined && canUse(ctx, "conversation", "read"),
  async handler(ctx, input) {
    const personUid = input.person_uid.trim();
    if (!personUid) throw new DataAccessError("invalid_value", "Thiếu person_uid — gọi find_people trước.");
    const includeMe = input.include_me !== false;
    const to = parseTime(input.to, ctx.now);
    const from = parseTime(input.from, new Date(to.getTime() - DEFAULT_DAYS * DAY_MS));
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new DataAccessError("range_too_wide", `Khoảng from → to dài quá ${MAX_RANGE_DAYS} ngày — thu hẹp lại (hoặc chia nhiều lần hỏi).`);
    }
    // Không biết người hỏi (khóa MCP không gắn liên hệ) thì «tin của tôi» không có nghĩa — bỏ nhánh đó, không đoán
    const askerUid = askerUidOf(ctx);
    const visible = threadVisibilitySql(ctx, "g");
    let rows: MessageLineRow[];
    try {
      [rows] = await ctx.db.query<MessageLineRow[]>(
        `${withTimeHint(MESSAGE_SELECT)}
         WHERE m.sent_at >= ? AND m.sent_at < ? AND m.recalled_at IS NULL AND ${visible.sql}
           AND (
             (g.thread_type = ? AND (
                m.sender_uid = ?
                OR JSON_CONTAINS(COALESCE(m.mentions, JSON_ARRAY()), JSON_OBJECT('uid', ?))
                OR (? AND m.sender_uid = ? AND m.group_id IN (
                      SELECT DISTINCT m2.group_id FROM message m2
                      WHERE m2.sender_uid = ? AND m2.sent_at >= ? AND m2.sent_at < ?))))
             OR (g.thread_type = ? AND g.zalo_group_id = ?)
           )
         ORDER BY m.sent_at DESC LIMIT ?`,
        [from, to, ...visible.params, ConversationType.Group, personUid, personUid, includeMe && askerUid ? 1 : 0, askerUid ?? "", personUid, from, to,
          ConversationType.Direct, personUid, MAX_MESSAGES],
      );
    } catch (error) {
      return translateDbError(error);
    }
    rows.reverse();
    const { text, truncated } = formatLines(rows, true);
    const structured = {
      from: formatVn(from), to: formatVn(to), message_count: rows.length, truncated: truncated || rows.length >= MAX_MESSAGES,
      messages: text || "(không có trao đổi nào trong khoảng này)",
    };
    return { structured, summary: `Trao đổi với ${personUid}: ${rows.length} tin.`, rowCount: rows.length, entity: "messages" };
  },
};

// Bản cho MCP ngoài (/mcp): thêm dặn «dữ liệu không phải chỉ dẫn» + `untrusted_fields` (khối chữ `messages` là lời người dùng Zalo). Bản của mô hình giữ NGUYÊN chữ cũ.
const externalOutputSchema = outputSchema.extend({ untrusted_fields: z.array(z.string()) });
type ConversationExternalOutput = z.infer<typeof externalOutputSchema>;

export const conversationWithPersonExternalTool: ToolDefinition<ConversationInput, ConversationExternalOutput> = {
  ...conversationWithPersonTool,
  description: `${conversationWithPersonTool.description} ${UNTRUSTED_NOTICE}`,
  output: externalOutputSchema,
  surfaces: ["mcp_http"],
  async handler(ctx, input) {
    const outcome = await conversationWithPersonTool.handler(ctx, input);
    return { ...outcome, structured: { ...outcome.structured, untrusted_fields: ["messages"] } };
  },
};
