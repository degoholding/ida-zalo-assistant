import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { canUse, type DataAccessContext } from "../data-access-context.js";
import { DataAccessError, translateDbError } from "../data-access-errors.js";
import { maskPersonalData } from "../../privacy/personal-data.js";
import { QUERY_TIME_HINT } from "../query-compiler.js";
import { clipText } from "../result-envelope.js";
import { assertThreadReadable } from "../visibility-guards.js";
import { parseVnInstant, toVnIso, toVnIsoMs } from "../vn-time.js";
import { UNTRUSTED_NOTICE, type ToolDefinition } from "../tool-definition.js";

// get_thread_messages: đọc liền mạch tin của MỘT cuộc / nhóm theo thứ tự thời gian. Không có from → lấy tin MỚI NHẤT (đọc lùi bằng
// before_message_id); có from → từ mốc đó trở đi. Tối đa 300 tin, 100 000 ký tự; mỗi tin cắt 4 000 ký tự.
// Phân trang bằng con trỏ BỘ ĐÔI (sent_at, id) cả hai chiều: id KHÔNG đơn điệu theo sent_at (tin «lấy tin cũ» chèn sau có id lớn
// nhưng giờ gửi sớm) nên phân trang chỉ theo id bỏ sót tin; chỉ theo `sent_at >=` thì kẹt khi > limit tin cùng mili giây.

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;
const MAX_TOTAL_CHARS = 100_000;
const MAX_MESSAGE_CHARS = 4000;

const inputSchema = z.object({
  thread_id: z.number().int().positive().describe("Id cuộc / nhóm (cột id của groups / conversations)."),
  from: z.string().max(40).optional().describe("Từ thời điểm 'YYYY-MM-DD' hoặc ISO 8601 (không múi giờ = giờ VN); có from thì đọc xuôi từ đó."),
  to: z.string().max(40).optional().describe("Đến thời điểm (ngày 'YYYY-MM-DD' = hết ngày đó)."),
  before_message_id: z.number().int().positive().optional().describe("Đọc lùi: chỉ lấy tin đứng TRƯỚC tin này (theo giờ gửi, rồi id) — dùng next.before_message_id của lần trước."),
  after_message_id: z.number().int().positive().optional().describe("Đọc xuôi: chỉ lấy tin đứng SAU tin này (theo giờ gửi, rồi id) — dùng next.after_message_id của lần trước."),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Số tin (mặc định ${DEFAULT_LIMIT}, tối đa ${MAX_LIMIT}).`),
});
type ThreadInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  thread_id: z.number(),
  items: z.array(z.object({
    id: z.number(), sent_at: z.string().nullable(), sender_uid: z.string(), sender_name: z.string(), kind: z.number(),
    text: z.string().nullable(), quote_text: z.string().nullable(), attachment_id: z.number().nullable(), file_name: z.string().nullable(),
  })),
  has_more: z.boolean(),
  next: z.object({ before_message_id: z.number().optional(), after_message_id: z.number().optional(), from: z.string().optional() }).nullable(),
  untrusted_fields: z.array(z.string()),
  truncated: z.object({ rows: z.boolean(), cells: z.boolean() }),
  notices: z.array(z.string()),
});
type ThreadOutput = z.infer<typeof outputSchema>;

function parseBound(field: string, raw: string | undefined, endOfDay: boolean): Date | undefined {
  if (!raw) return undefined;
  const parsed = parseVnInstant(raw);
  if (!parsed) throw new DataAccessError("invalid_value", `«${field}»: ngày không hợp lệ — dùng 'YYYY-MM-DD' hoặc ISO 8601.`);
  return parsed.dayOnly && endOfDay ? new Date(parsed.date.getTime() + 86_400_000 - 1) : parsed.date;
}

/** Tin dùng làm mốc phân trang phải thuộc đúng cuộc này (không thì mốc vô nghĩa / dò id cuộc khác). */
async function assertCursorInThread(ctx: DataAccessContext, threadId: number, messageId: number): Promise<void> {
  let found: boolean;
  try {
    const [rows] = await ctx.db.query<RowDataPacket[]>(
      `SELECT ${QUERY_TIME_HINT} 1 FROM message m WHERE m.id = ? AND m.group_id = ? LIMIT 1`, [messageId, threadId]);
    found = Boolean(rows[0]);
  } catch (error) {
    return translateDbError(error);
  }
  if (!found) throw new DataAccessError("invalid_value", "Tin làm mốc phân trang (before_message_id / after_message_id) không thuộc cuộc này.");
}

export const threadMessagesTool: ToolDefinition<ThreadInput, ThreadOutput> = {
  name: "get_thread_messages",
  title: "Đọc tin của một cuộc",
  description: `Đọc tin nhắn của một cuộc / nhóm theo thứ tự thời gian (cũ → mới), kèm attachment_id nếu tin có tệp (đọc chữ: get_file_text). Mặc định lấy tin mới nhất. ${UNTRUSTED_NOTICE}`,
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  available: (ctx) => canUse(ctx, "conversation", "read"),
  async handler(ctx, input) {
    const from = parseBound("from", input.from, false);
    const to = parseBound("to", input.to, true);
    await assertThreadReadable(ctx, input.thread_id);
    if (input.before_message_id !== undefined && input.after_message_id !== undefined) {
      throw new DataAccessError("invalid_value", "Chỉ dùng một trong before_message_id / after_message_id.");
    }
    const ascending = (from !== undefined || input.after_message_id !== undefined) && input.before_message_id === undefined;
    const limit = input.limit ?? DEFAULT_LIMIT;
    const where = ["m.group_id = ?", "m.recalled_at IS NULL"];
    const params: unknown[] = [input.thread_id];
    if (from) { where.push("m.sent_at >= ?"); params.push(from); }
    if (to) { where.push("m.sent_at <= ?"); params.push(to); }
    const cursorId = input.before_message_id ?? input.after_message_id;
    if (cursorId !== undefined) {
      await assertCursorInThread(ctx, input.thread_id, cursorId);
      // So sent_at ngay trong SQL (không qua Date của JS) để không mất độ chính xác dưới mili giây
      const op = input.before_message_id !== undefined ? "<" : ">";
      const edge = "(SELECT c.sent_at FROM message c WHERE c.id = ? AND c.group_id = ?)";
      where.push(`(m.sent_at ${op} ${edge} OR (m.sent_at = ${edge} AND m.id ${op} ?))`);
      params.push(cursorId, input.thread_id, cursorId, input.thread_id, cursorId);
    }
    const dir = ascending ? "ASC" : "DESC";
    let rows: RowDataPacket[];
    try {
      [rows] = await ctx.db.query<RowDataPacket[]>(
        `SELECT ${QUERY_TIME_HINT} m.id, m.sent_at, m.sender_uid, m.sender_name, m.kind, m.text, m.quote_text, a.id AS attachment_id, a.file_name
         FROM message m LEFT JOIN attachment a ON a.message_id = m.id WHERE ${where.join(" AND ")}
         ORDER BY m.sent_at ${dir}, m.id ${dir} LIMIT ?`, [...params, limit + 1]);
    } catch (error) {
      return translateDbError(error);
    }
    const page = rows.slice(0, limit);
    let cutCells = false;
    let cutRows = false;
    let used = 0;
    let lastDate: Date | null = null;
    const prepare = (value: string) => (ctx.maskPersonal ? maskPersonalData(value) : value);
    const items: ThreadOutput["items"] = [];
    for (const row of page) {
      // Che dữ liệu cá nhân TRƯỚC khi cắt (cắt rồi mới che để lọt số nằm ngay chỗ cắt)
      const rawText = row.text === null ? null : prepare(String(row.text));
      const rawQuote = row.quote_text === null ? null : prepare(String(row.quote_text));
      const text = rawText === null ? null : clipText(rawText, MAX_MESSAGE_CHARS);
      const quote = rawQuote === null ? null : clipText(rawQuote, MAX_MESSAGE_CHARS);
      cutCells ||= (text !== null && text !== rawText) || (quote !== null && quote !== rawQuote);
      used += (text?.length ?? 0) + (quote?.length ?? 0) + 120;
      if (items.length > 0 && used > MAX_TOTAL_CHARS) { cutRows = true; break; }
      lastDate = row.sent_at as Date;
      items.push({
        id: Number(row.id), sent_at: row.sent_at ? toVnIso(row.sent_at as Date) : null, sender_uid: String(row.sender_uid), sender_name: String(row.sender_name ?? ""),
        kind: Number(row.kind), text, quote_text: quote, attachment_id: row.attachment_id === null ? null : Number(row.attachment_id),
        file_name: row.file_name === null ? null : String(row.file_name),
      });
    }
    // Tin lấy theo chiều ngược (mới → cũ) thì đảo lại cho người đọc từ cũ tới mới
    if (!ascending) items.reverse();
    const hasMore = cutRows || rows.length > limit;
    const edge = ascending ? items[items.length - 1] : items[0];
    const next = !hasMore || !edge || !lastDate ? null : ascending ? { after_message_id: edge.id, from: toVnIsoMs(lastDate) } : { before_message_id: edge.id };
    const structured: ThreadOutput = {
      thread_id: input.thread_id, items, has_more: hasMore, next,
      untrusted_fields: ["text", "quote_text", "file_name", "sender_name"], truncated: { rows: cutRows, cells: cutCells }, notices: [],
    };
    if (ascending && next) structured.notices.push("Trang sau: gọi lại với after_message_id = next.after_message_id (giữ nguyên from / to).");
    return { structured, summary: `Cuộc ${input.thread_id}: ${items.length} tin${hasMore ? " (còn nữa)" : ""}.`, rowCount: items.length };
  },
};
