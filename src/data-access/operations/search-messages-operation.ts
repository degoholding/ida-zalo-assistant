import { z } from "zod/v4";
import { canUse } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { MISSING_QUERY_MESSAGE, runMessageSearch } from "../reads/message-search-core.js";
import { parseVnInstant, toVnIso } from "../vn-time.js";
import { UNTRUSTED_NOTICE, type ToolDefinition } from "../tool-definition.js";

// search_messages: tìm tin theo TỪ KHÓA (chỉ mục toàn văn, gõ không dấu cũng khớp) trong các nhóm thấy được. Nhóm = nhóm trong phạm vi
// của người gọi; nhóm Mật chỉ khi ctx được Mật. Phần tìm nằm ở `reads/message-search-core.ts` (dùng chung với bản của trợ lý, phase 6 plan trợ lý qua MCP):
// ngoài từ khóa còn tìm theo tên nhóm (`group_name`) và «ai nhắc (tag) tôi» (`mentions_me`, cần biết người gọi — khóa MCP không có thì báo lỗi).

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_THREAD_IDS = 50;

const inputSchema = z.object({
  query: z.string().min(1).max(200).optional().describe("Từ khóa, vd 'công nợ Minh Phát'; cụm cố định đặt trong ngoặc kép. Bắt buộc trừ khi mentions_me = true."),
  group_name: z.string().max(100).optional().describe("Tên (một phần) nhóm cần tìm — mọi nhóm đọc được khớp tên; bỏ trống = mọi nhóm."),
  mentions_me: z.boolean().optional().describe("true = chỉ tin có TAG (@) chính người gọi («ai nhắc tới tôi»); không có from thì xét 7 ngày gần nhất (tối đa 90)."),
  thread_ids: z.array(z.number().int().positive()).max(MAX_THREAD_IDS).optional().describe("Chỉ tìm trong các cuộc / nhóm này (id từ query_records groups)."),
  sender_name: z.string().max(100).optional().describe("Lọc người gửi theo tên (một phần)."),
  from: z.string().max(40).optional().describe("Từ thời điểm: 'YYYY-MM-DD' hoặc ISO 8601 (không múi giờ = giờ VN)."),
  to: z.string().max(40).optional().describe("Đến thời điểm (ngày 'YYYY-MM-DD' = hết ngày đó)."),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Số kết quả (mặc định ${DEFAULT_LIMIT}, tối đa ${MAX_LIMIT}).`),
});
type SearchInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  hits: z.array(z.object({
    message_id: z.number(), thread_id: z.number(), thread_name: z.string(), sender_name: z.string(), sent_at: z.string().nullable(), snippet: z.string(),
  })),
  more: z.boolean(),
  window_from: z.string().nullable(),
  indexed_from: z.string().nullable(),
  untrusted_fields: z.array(z.string()),
  notices: z.array(z.string()),
});
type SearchOutput = z.infer<typeof outputSchema>;

function parseBound(field: string, raw: string | undefined, endOfDay: boolean): Date | undefined {
  if (!raw) return undefined;
  const parsed = parseVnInstant(raw);
  if (!parsed) throw new DataAccessError("invalid_value", `«${field}»: ngày không hợp lệ — dùng 'YYYY-MM-DD' hoặc ISO 8601.`);
  // `to` chỉ có ngày = hết ngày đó (searchMessages so `sent_at <= to`)
  return parsed.dayOnly && endOfDay ? new Date(parsed.date.getTime() + 86_400_000 - 1) : parsed.date;
}

export const searchMessagesTool: ToolDefinition<SearchInput, SearchOutput> = {
  name: "search_messages",
  title: "Tìm tin nhắn theo từ khóa",
  description: `Tìm tin nhắn cũ theo từ khóa (nhanh hơn đọc cả nhóm); mới nhất trước, kèm đoạn trích quanh chỗ khớp. Đọc liền mạch quanh một tin: get_thread_messages. ${UNTRUSTED_NOTICE}`,
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  available: (ctx) => canUse(ctx, "conversation", "read"),
  async handler(ctx, input) {
    const from = parseBound("from", input.from, false);
    const to = parseBound("to", input.to, true);
    if (!input.query && !input.mentions_me) throw new DataAccessError("invalid_value", MISSING_QUERY_MESSAGE);
    const result = await runMessageSearch(ctx, {
      query: input.query ?? "", mentionsMe: input.mentions_me === true, groupName: input.group_name, threadIds: input.thread_ids,
      senderName: input.sender_name, from, to, limit: input.limit ?? DEFAULT_LIMIT,
    });
    const notices: string[] = [];
    if (result.windowFrom) notices.push(`Câu tìm ngắn / quá phổ biến nên chỉ tìm các tin từ ${toVnIso(result.windowFrom)} — thêm 'from' để tìm xa hơn.`);
    if (result.indexedFrom) notices.push(`Tin cũ đang được chép vào chỉ mục tìm, hiện tìm được từ khoảng ${toVnIso(result.indexedFrom)}.`);
    const structured: SearchOutput = {
      hits: result.hits.map((hit) => ({
        message_id: hit.messageId, thread_id: hit.threadId, thread_name: hit.threadName, sender_name: hit.senderName,
        sent_at: hit.sentAt ? toVnIso(hit.sentAt) : null, snippet: hit.snippet,
      })),
      more: result.more,
      window_from: result.windowFrom ? toVnIso(result.windowFrom) : null,
      indexed_from: result.indexedFrom ? toVnIso(result.indexedFrom) : null,
      untrusted_fields: ["snippet", "thread_name", "sender_name"], notices,
    };
    if (result.range) structured.notices.push(`Tin nhắc tới người gọi từ ${toVnIso(result.range.from)} đến ${toVnIso(result.range.to)}.`);
    const label = input.mentions_me ? "tin nhắc tới người gọi" : `«${input.query}»`;
    return { structured, summary: `Tìm ${label}: ${structured.hits.length} tin khớp.`, rowCount: structured.hits.length };
  },
};
