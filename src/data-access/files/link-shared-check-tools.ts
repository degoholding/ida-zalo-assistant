import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { linkFingerprint } from "../../assistant/link-fingerprint.js";
import { canUse } from "../data-access-context.js";
import { DataAccessError, translateDbError } from "../data-access-errors.js";
import { QUERY_TIME_HINT } from "../query-compiler.js";
import { threadVisibilitySql } from "../visibility-guards.js";
import type { ToolDefinition } from "../tool-definition.js";

// link_shared_check (mặt LỆNH): bước dữ liệu của `read_link` — link có nằm trong tin (60 ngày gần đây, chưa thu hồi) của cuộc người hỏi THẤY ĐƯỢC không
// (phạm vi + cuộc riêng của mình + Mật theo cờ; hỏi trong nhóm thì chỉ nhóm đó). Chống mô hình bị «dụ» tự chế link nhét dữ liệu nội bộ vào đường dẫn
// hoặc đọc link của cuộc riêng người khác / nhóm Mật. Việc tải nội dung link là tác động ngoài, nằm ngoài MCP.

const LINK_LOOKBACK_DAYS = 60;

const inputSchema = z.object({ url: z.string().min(1).max(8000) });
type LinkInput = z.infer<typeof inputSchema>;
const outputSchema = z.object({ shared: z.boolean() });

export const linkSharedCheckTool: ToolDefinition<LinkInput, z.infer<typeof outputSchema>> = {
  name: "link_shared_check",
  title: "Link có trong tin người hỏi thấy được không",
  description: "Kiểm một link đã được chia sẻ trong tin nhắn thuộc phạm vi người hỏi. Chỉ lệnh nội bộ của trợ lý.",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_command"],
  family: "files",
  assistantErrorShape: "string",
  available: (ctx) => canUse(ctx, "conversation", "read"),
  async handler(ctx, input) {
    const fingerprint = linkFingerprint(input.url);
    if (!fingerprint) throw new DataAccessError("invalid_value", "Thiếu hoặc sai link — chép nguyên văn link trong tin nhắn.");
    const escaped = fingerprint.replace(/[\\%_]/g, (char) => `\\${char}`);
    const visible = threadVisibilitySql(ctx, "g");
    const scopeId = ctx.groupScopeId;
    let rows: RowDataPacket[];
    try {
      [rows] = await ctx.db.query<RowDataPacket[]>(
        `SELECT ${QUERY_TIME_HINT} 1 FROM message m JOIN zalo_group g ON g.id = m.group_id
         WHERE m.text LIKE ? AND m.sent_at > NOW() - INTERVAL ? DAY AND m.recalled_at IS NULL AND ${visible.sql} ${scopeId ? "AND m.group_id = ?" : ""} LIMIT 1`,
        [`%${escaped}%`, LINK_LOOKBACK_DAYS, ...visible.params, ...(scopeId ? [scopeId] : [])]);
    } catch (error) {
      return translateDbError(error);
    }
    const shared = rows.length > 0;
    return { structured: { shared }, summary: shared ? "Link có trong tin." : "Link không có trong tin.", rowCount: rows.length, entity: "messages" };
  },
};
