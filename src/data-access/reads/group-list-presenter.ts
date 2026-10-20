import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { ConversationType } from "../../constants.js";
import { formatVn } from "../../assistant/message-line-format.js";
import { canUse } from "../data-access-context.js";
import { translateDbError } from "../data-access-errors.js";
import { threadVisibilitySql } from "../visibility-guards.js";
import type { ToolDefinition } from "../tool-definition.js";

// list_groups (mặt trợ lý): liệt kê nhóm bot đang lưu tin — id, tên, tên gọi ngắn, công ty, số tin, tin gần nhất — để mô hình tìm id theo tên.
// Giữ ĐẾM SỐNG số tin (truy vấn chép nguyên từ công cụ cũ) thay vì cột đếm sẵn, để số trả lời không đổi. Phạm vi từ `threadVisibilitySql`
// (nhóm ngoài phạm vi / Mật khi chưa cấp cờ bị loại); hỏi trong nhóm (`ctx.groupScopeId`) chỉ ra đúng nhóm đó.

const MAX_GROUPS = 50;

const inputSchema = z.object({
  query: z.string().optional().describe("Một phần tên nhóm hoặc tên gọi ngắn; bỏ trống để lấy tất cả"),
});
type ListGroupsInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  groups: z.array(z.object({
    id: z.number(), name: z.string(), short_name: z.string().nullable(), company: z.string(), message_count: z.number(), last_message: z.string(),
  })),
});
type ListGroupsOutput = z.infer<typeof outputSchema>;

export const groupListPresenterTool: ToolDefinition<ListGroupsInput, ListGroupsOutput> = {
  name: "list_groups",
  title: "Liệt kê nhóm Zalo",
  description: "Liệt kê các nhóm Zalo bot đang lưu tin (id, tên, tên gọi ngắn, số tin, tin gần nhất). Dùng để tìm id nhóm theo tên.",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_model"],
  family: "reads",
  assistantErrorShape: "string",
  available: (ctx) => canUse(ctx, "conversation", "read"),
  async handler(ctx, input) {
    const query = input.query?.trim() ?? "";
    const visible = threadVisibilitySql(ctx, "g");
    const scopeId = ctx.groupScopeId ?? 0;
    let rows: RowDataPacket[];
    try {
      [rows] = await ctx.db.query<RowDataPacket[]>(
        `SELECT g.id, g.name, g.label, c.name AS company,
                (SELECT COUNT(*) FROM message m WHERE m.group_id = g.id) AS message_count,
                (SELECT MAX(m.sent_at) FROM message m WHERE m.group_id = g.id) AS last_message_at
         FROM zalo_group g LEFT JOIN company c ON c.id = g.company_id
         WHERE g.thread_type = ? AND ${visible.sql}
           AND (? = '' OR g.name LIKE ? OR g.label LIKE ?) AND (? = 0 OR g.id = ?)
         ORDER BY last_message_at DESC LIMIT ${MAX_GROUPS}`,
        [ConversationType.Group, ...visible.params, query, `%${query}%`, `%${query}%`, scopeId, scopeId],
      );
    } catch (error) {
      return translateDbError(error);
    }
    const groups = rows.map((row) => ({
      id: Number(row.id), name: String(row.name ?? ""), short_name: row.label === null ? null : String(row.label), company: String(row.company ?? ""),
      message_count: Number(row.message_count), last_message: row.last_message_at ? formatVn(row.last_message_at as Date) : "",
    }));
    return { structured: { groups }, summary: `${groups.length} nhóm.`, rowCount: groups.length, entity: "groups" };
  },
};
