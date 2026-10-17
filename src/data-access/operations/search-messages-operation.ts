import { z } from "zod/v4";
import { isSearchTimeoutError, searchMessages } from "../../search/message-search.js";
import { canUse } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { assertNoPersonalNumberProbe } from "../masked-filter-guard.js";
import { parseVnInstant, toVnIso } from "../vn-time.js";
import { UNTRUSTED_NOTICE, type ToolDefinition } from "../tool-definition.js";

// search_messages: tìm tin theo TỪ KHÓA (chỉ mục toàn văn, gõ không dấu cũng khớp) trong các nhóm thấy được. Nhóm = nhóm trong phạm vi
// của người gọi; nhóm Mật chỉ khi ctx được Mật.

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_THREAD_IDS = 50;

const inputSchema = z.object({
  query: z.string().min(1).max(200).describe("Từ khóa, vd 'công nợ Minh Phát'; cụm cố định đặt trong ngoặc kép."),
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
    // Che dữ liệu cá nhân bật: không cho dò SĐT / CCCD từng số qua câu tìm
    assertNoPersonalNumberProbe(ctx, "query", input.query);
    const scope = ctx.principal.groupIds;
    // Giao danh sách cuộc người gọi chọn với phạm vi được gán; quản trị («mọi nhóm») + không chọn → không giới hạn
    const groupIds = input.thread_ids ? (scope ? input.thread_ids.filter((id) => scope.includes(id)) : input.thread_ids) : (scope ?? undefined);
    let result;
    try {
      result = await searchMessages(ctx.db, {
        query: input.query, groupIds, excludeConfidential: !ctx.includeConfidential, onlyReadGroups: false, onlyReadableThreads: true,
        ownDirectThreads: ctx.ownDirectThreadsOnly ? { uid: ctx.ownDirectUid ?? null } : undefined, maskPersonal: ctx.maskPersonal,
        senderName: input.sender_name, from, to, limit: input.limit ?? DEFAULT_LIMIT, now: ctx.now,
      });
    } catch (error) {
      if (isSearchTimeoutError(error)) throw new DataAccessError("timeout", "Tìm lâu quá — thêm từ khóa cụ thể hơn hoặc thu hẹp thread_ids / khoảng ngày.");
      throw error;
    }
    const notices: string[] = [];
    if (result.windowFrom) notices.push(`Câu tìm ngắn / quá phổ biến nên chỉ tìm các tin từ ${toVnIso(result.windowFrom)} — thêm 'from' để tìm xa hơn.`);
    if (result.indexedFrom) notices.push(`Tin cũ đang được chép vào chỉ mục tìm, hiện tìm được từ khoảng ${toVnIso(result.indexedFrom)}.`);
    const structured: SearchOutput = {
      hits: result.hits.map((hit) => ({
        message_id: hit.messageId, thread_id: hit.threadId, thread_name: hit.threadName, sender_name: hit.senderName,
        sent_at: hit.sentAt ? toVnIso(hit.sentAt) : null, snippet: hit.snippet,
      })),
      window_from: result.windowFrom ? toVnIso(result.windowFrom) : null,
      indexed_from: result.indexedFrom ? toVnIso(result.indexedFrom) : null,
      untrusted_fields: ["snippet", "thread_name", "sender_name"], notices,
    };
    return { structured, summary: `Tìm «${input.query}»: ${structured.hits.length} tin khớp.`, rowCount: structured.hits.length };
  },
};
