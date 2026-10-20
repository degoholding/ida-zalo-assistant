import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { AttachmentStatus, ConversationType } from "../../constants.js";
import { formatVn, parseTime } from "../../assistant/message-line-format.js";
import { canUse, type DataAccessContext } from "../data-access-context.js";
import { translateDbError } from "../data-access-errors.js";
import { assertNoPersonalNumberProbe } from "../masked-filter-guard.js";
import { QUERY_TIME_HINT } from "../query-compiler.js";
import { threadVisibilitySql } from "../visibility-guards.js";
import { UNTRUSTED_NOTICE, type ToolDefinition } from "../tool-definition.js";

// search_files: tìm tệp / ảnh đã gửi theo tên tệp, chú thích tin, hoặc CHỮ ĐÃ BÓC (attachment_text) — mỗi từ khóa (≥ 2 ký tự, tối đa 6) phải có ở một trong ba chỗ (AND), nên «bao gia
// thanh cong» khớp «Báo giá DL Thành Công.xlsx». Không từ khóa = tệp gần đây của CHÍNH người hỏi (họ gửi, hoặc nằm trong cuộc riêng của họ với bot — chỉ khi biết người hỏi, tức mặt
// trợ lý); hỏi trong nhóm = tệp gần đây của nhóm đó. Phạm vi = `threadVisibilitySql` (nhóm được gán, Mật theo cờ, cuộc riêng của chính mình). Hai vỏ: bản MÔ HÌNH (tên + khai báo + hình trả
// lời giữ y công cụ cũ, mặt `assistant_model`) và bản CỔNG NGOÀI `mcp_http` (cùng lõi, thêm dặn dữ liệu không đáng tin + `untrusted_fields`).

const MAX_WORDS = 6;
const MAX_ROWS = 20;

const inputSchema = z.object({
  query: z.string().describe("Từ khóa trong tên tệp hoặc nội dung tệp đã đọc, vd 'bao gia Thanh Cong'. ĐỂ TRỐNG = liệt kê tệp gần đây của người hỏi (tệp họ gửi, hoặc trong cuộc riêng với bot) — dùng khi người hỏi nói «file này» mà chưa rõ tệp nào"),
  group_id: z.number().int().optional().describe("Chỉ tìm trong nhóm này (tùy chọn)"),
  from: z.string().optional().describe("Từ ngày, ISO 8601 (tùy chọn)"),
  to: z.string().optional().describe("Đến ngày, ISO 8601 (tùy chọn)"),
});
type SearchFilesInput = z.infer<typeof inputSchema>;

const fileSchema = z.object({
  id: z.number(), name: z.string(), group: z.string(), sender: z.string(), sent: z.string(), size_kb: z.number(),
  can_send: z.boolean(), can_read: z.boolean(), already_read: z.boolean(),
});
const outputSchema = z.object({ files: z.array(fileSchema) });
type SearchFilesOutput = z.infer<typeof outputSchema>;

/** Lõi tìm tệp — hai vỏ dùng chung. */
export async function searchFilesCore(ctx: DataAccessContext, input: SearchFilesInput): Promise<SearchFilesOutput> {
  const query = input.query.trim();
  // Che bật: không cho dò SĐT / CCCD bằng từ khóa tìm vào chữ đã bóc (BC2 — như các công cụ tìm khác)
  assertNoPersonalNumberProbe(ctx, "query", query);
  const scopeGroupId = ctx.groupScopeId;
  const groupId = scopeGroupId ?? (input.group_id || 0);
  const from = parseTime(input.from, new Date(0));
  const to = parseTime(input.to, new Date(ctx.now.getTime() + 86_400_000));
  const words = query.split(/\s+/).filter((word) => word.length >= 2).slice(0, MAX_WORDS);
  // Người hỏi: chủ thể liên hệ Zalo của lượt (mặt trợ lý). Cổng ngoài không có → không thu hẹp theo người gửi (chỉ phạm vi tài khoản)
  const askerUid = ctx.contactActor?.uid ?? ctx.ownDirectUid ?? undefined;
  const ownOnly = !words.length && scopeGroupId === undefined && askerUid !== undefined;
  const conditions = words.length
    ? words.map(() => "(a.file_name LIKE ? OR m.text LIKE ? OR t.text LIKE ?)").join(" AND ")
    : ownOnly ? `(m.sender_uid = ? OR (g.thread_type = ${ConversationType.Direct} AND g.zalo_group_id = ?))` : "1 = 1";
  const conditionParams = words.length ? words.flatMap((word) => [`%${word}%`, `%${word}%`, `%${word}%`]) : ownOnly ? [askerUid, askerUid] : [];
  const visible = threadVisibilitySql(ctx, "g");
  let rows: RowDataPacket[];
  try {
    [rows] = await ctx.db.query<RowDataPacket[]>(
      `SELECT ${QUERY_TIME_HINT} a.id, a.file_name, a.file_ext, a.status, a.stored_bytes, a.declared_size, m.sent_at, m.sender_name, m.zalo_msg_type,
              COALESCE(NULLIF(g.label, ''), g.name) AS group_name, g.thread_type, t.char_count AS text_chars
       FROM attachment a JOIN message m ON m.id = a.message_id JOIN zalo_group g ON g.id = a.group_id
       LEFT JOIN attachment_text t ON t.attachment_id = a.id
       WHERE ${conditions} AND (? = 0 OR a.group_id = ?) AND m.sent_at >= ? AND m.sent_at < ? AND m.recalled_at IS NULL
         AND ${visible.sql}
       ORDER BY m.sent_at DESC LIMIT ${MAX_ROWS}`,
      [...conditionParams, groupId, groupId, from, to, ...visible.params]);
  } catch (error) {
    return translateDbError(error);
  }
  return {
    files: rows.map((row) => ({
      id: Number(row.id),
      name: String(row.file_name || `(${row.zalo_msg_type})`),
      group: row.thread_type === ConversationType.Direct ? "nhắn riêng bot" : String(row.group_name ?? ""),
      sender: String(row.sender_name ?? ""),
      sent: formatVn(row.sent_at),
      size_kb: Math.round(((row.stored_bytes ?? row.declared_size) || 0) / 1024),
      can_send: row.status === AttachmentStatus.Stored,
      can_read: row.status === AttachmentStatus.Stored,
      // Dòng tự đọc ảnh hỏng có char_count = 0 nhưng chưa có chữ — chưa tính là đã đọc
      already_read: Number(row.text_chars ?? 0) > 0,
    })),
  };
}

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false as const };

/** Bản cho MÔ HÌNH trợ lý: tên + khai báo + hình trả lời GIỮ NGUYÊN công cụ cũ (T3). */
export const searchFilesModelTool: ToolDefinition<SearchFilesInput, SearchFilesOutput> = {
  name: "search_files",
  title: "Tìm tệp đã gửi",
  description: "Tìm tệp/ảnh đã gửi trong các nhóm và tin riêng theo tên tệp hoặc chú thích (không cần dấu).",
  input: () => inputSchema,
  output: outputSchema,
  annotations: READ_ONLY,
  surfaces: ["assistant_model"],
  family: "files",
  assistantErrorShape: "string",
  available: (ctx) => canUse(ctx, "file", "read"),
  async handler(ctx, input) {
    const structured = await searchFilesCore(ctx, input);
    return { structured, summary: `Tìm tệp «${input.query.trim()}»: ${structured.files.length} tệp.`, rowCount: structured.files.length, entity: "files" };
  },
};

const externalOutputSchema = outputSchema.extend({ untrusted_fields: z.array(z.string()) });

/** Bản cho cổng /mcp ngoài: cùng lõi; tên tệp / tên nhóm / người gửi do người dùng Zalo đặt nên khai là dữ liệu không đáng tin. Không có «người hỏi» nên không thu hẹp theo người gửi. */
export const searchFilesExternalTool: ToolDefinition<SearchFilesInput, z.infer<typeof externalOutputSchema>> = {
  name: "search_files",
  title: "Tìm tệp đã gửi",
  description: `${searchFilesModelTool.description} Tìm cả trong chữ đã bóc từ tệp; để trống từ khóa = tệp gần đây trong phạm vi tài khoản. Đọc chữ trong tệp bằng get_file_text. ${UNTRUSTED_NOTICE}`,
  input: () => inputSchema,
  output: externalOutputSchema,
  annotations: READ_ONLY,
  surfaces: ["mcp_http"],
  family: "files",
  available: (ctx) => canUse(ctx, "file", "read"),
  async handler(ctx, input) {
    const structured = await searchFilesCore(ctx, input);
    return {
      structured: { ...structured, untrusted_fields: ["files"] },
      summary: `Tìm tệp «${input.query.trim()}»: ${structured.files.length} tệp.`, rowCount: structured.files.length, entity: "files",
    };
  },
};
