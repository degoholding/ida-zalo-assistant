import { z } from "zod/v4";
import { formatVnClock } from "./vn-clock-format.js";
import { LIKE_WINDOW_DAYS } from "../../search/message-search.js";
import { canUse } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { parseVnInstant } from "../vn-time.js";
import type { ToolDefinition } from "../tool-definition.js";
import { runMessageSearch } from "./message-search-core.js";

// search_messages (mặt trợ lý): CÙNG lõi tìm với bản của cổng /mcp (`reads/message-search-core.ts`) nhưng tên tham số + câu chữ + hình kết quả GIỮ NGUYÊN công
// cụ cũ của trợ lý (`group` thay `group_name`, `person` thay `sender_name`, `results[]` có `time_vn` dạng «HH:mm dd/MM/yyyy», `window_note` / `index_note` / `note`)
// để mô hình không phải học lại (test khớp khai báo). Hỏi trong nhóm thì chỉ tìm trong nhóm đó (lõi bỏ qua `group`).

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const inputSchema = z.object({
  query: z.string().optional().describe("Từ khóa, vd 'công nợ Minh Phát' hoặc '\"hợp đồng thép\"'"),
  mentions_me: z.boolean().optional().describe("true = chỉ tin có TAG (@) chính người đang hỏi — «ai nhắc tới tôi». Không truyền from thì xét 7 ngày gần nhất"),
  group: z.string().optional().describe("Tên (một phần) nhóm cần tìm, bỏ trống = mọi nhóm"),
  person: z.string().optional().describe("Tên (một phần) người gửi, bỏ trống = mọi người"),
  from: z.string().optional().describe("Từ thời điểm, ISO 8601 có +07:00 (tùy chọn)"),
  to: z.string().optional().describe("Đến thời điểm, ISO 8601 có +07:00 (tùy chọn)"),
  limit: z.number().int().optional().describe(`Số tin tối đa, mặc định ${DEFAULT_LIMIT}, tối đa ${MAX_LIMIT}`),
});
type SearchInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  query: z.string().optional(),
  mentions_me: z.boolean().optional(),
  from_vn: z.string().optional(),
  to_vn: z.string().optional(),
  count: z.number(),
  more: z.boolean(),
  results: z.array(z.object({ message_id: z.number(), group: z.string(), sender: z.string(), time_vn: z.string(), snippet: z.string() })),
  searched_from_vn: z.string().optional(),
  window_note: z.string().optional(),
  index_note: z.string().optional(),
  note: z.string().optional(),
});
type SearchOutput = z.infer<typeof outputSchema>;

/** «2026-03-01» = đầu ngày (from) / cuối ngày (to) giờ VN; ISO đầy đủ đọc như công cụ khác. Truyền mà sai → undefined + cờ lỗi (báo lại, không bỏ qua lặng lẽ). */
function parseBound(raw: string | undefined, edge: "start" | "end"): Date | undefined | null {
  if (!raw?.trim()) return undefined;
  const parsed = parseVnInstant(raw);
  if (!parsed) return null;
  return parsed.dayOnly && edge === "end" ? new Date(parsed.date.getTime() + 86_400_000 - 1) : parsed.date;
}

export const searchMessagesModelTool: ToolDefinition<SearchInput, SearchOutput> = {
  name: "search_messages",
  title: "Tìm tin nhắn theo từ khóa",
  description:
    "TÌM TIN NHẮN cũ theo TỪ KHÓA trong các nhóm (nhanh, không phải đọc cả nhóm): «tìm tin nói về công nợ Minh Phát», «ai nhắc tới " +
    "hợp đồng thép», «tuần trước X nói gì về giá». Trả về tin khớp mới nhất trước: nhóm, người gửi, giờ, đoạn trích. Từ khóa ngắn, " +
    "đúng chữ có trong tin (gõ không dấu cũng khớp); cụm cố định đặt trong ngoặc kép. Cần hiểu trước / sau một tin thì " +
    "get_group_messages quanh giờ đó. «Ai nhắc tới tôi / t / tao / em…», «ai tag tôi» (người hỏi tự nói về mình) → mentions_me = true, " +
    "không cần query (thêm query nếu hỏi kèm chủ đề).",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_model"],
  family: "reads",
  assistantErrorShape: "string",
  available: (ctx) => canUse(ctx, "conversation", "read"),
  async handler(ctx, input) {
    const query = input.query?.trim() ?? "";
    const from = parseBound(input.from, "start");
    const to = parseBound(input.to, "end");
    if (from === null || to === null) {
      throw new DataAccessError("invalid_value", "from / to sai định dạng — dùng ISO 8601 có +07:00 (vd 2026-10-01T00:00:00+07:00) hoặc ngày 2026-10-01.");
    }
    const limit = input.limit !== undefined && input.limit > 0 ? Math.min(MAX_LIMIT, input.limit) : DEFAULT_LIMIT;
    const outcome = await runMessageSearch(ctx, {
      query, mentionsMe: input.mentions_me === true, groupName: input.group?.trim() || undefined, senderName: input.person, from, to, limit,
    });
    const results = outcome.hits.map((hit) => ({
      message_id: hit.messageId, group: hit.threadName, sender: hit.senderName, time_vn: formatVnClock(hit.sentAt.getTime()), snippet: hit.snippet,
    }));
    const base = { count: results.length, more: outcome.more, results };
    if (outcome.mentions) {
      const structured: SearchOutput = {
        mentions_me: true, from_vn: formatVnClock(outcome.range!.from.getTime()), to_vn: formatVnClock(outcome.range!.to.getTime()), ...base,
        ...(results.length ? {} : { note: "Không có tin nào tag người hỏi trong khoảng này — có thể họ được nhắc bằng tên mà không tag: thử search_messages với query = tên người hỏi." }),
      };
      return { structured, summary: `${results.length} tin nhắc tới người hỏi.`, rowCount: results.length, entity: "messages" };
    }
    const structured: SearchOutput = {
      query, ...base,
      ...(outcome.windowFrom ? {
        searched_from_vn: formatVnClock(outcome.windowFrom.getTime()),
        window_note: `Chỉ tìm các tin từ ${formatVnClock(outcome.windowFrom.getTime())} trở đi (${LIKE_WINDOW_DAYS} ngày — từ khóa quá phổ biến / quá ngắn) — nói rõ với người hỏi; muốn xa hơn thì truyền from.`,
      } : {}),
      ...(outcome.indexedFrom ? {
        index_note: `Hệ thống đang chép tin cũ vào chỉ mục tìm — mới tìm được các tin từ khoảng ${formatVnClock(outcome.indexedFrom.getTime())} trở đi; ` +
          "tin cũ hơn có thể chưa ra — nói rõ với người hỏi, cần gấp thì đọc nhóm bằng get_group_messages.",
      } : {}),
      ...(results.length ? {} : { note: "Không có tin nào khớp — thử từ khóa ngắn hơn / từ đồng nghĩa, hoặc nới khoảng thời gian." }),
    };
    return { structured, summary: `Tìm «${query}»: ${results.length} tin khớp.`, rowCount: results.length, entity: "messages" };
  },
};
