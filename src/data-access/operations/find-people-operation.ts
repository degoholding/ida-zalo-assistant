import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { ConversationType } from "../../constants.js";
import { canUse } from "../data-access-context.js";
import { DataAccessError, translateDbError } from "../data-access-errors.js";
import { contactScopeOf } from "../reads/contact-scope-of-actor.js";
import { threadVisibilitySql } from "../visibility-guards.js";
import type { ToolDefinition } from "../tool-definition.js";

// find_people: tìm người trong Danh bạ theo tên (kể cả tên hiển thị riêng trong từng nhóm), kèm các nhóm người đó đang ở (chỉ nhóm thấy được).
// Dùng cả cho cổng /mcp lẫn trợ lý (mặt `assistant_model`, họ `reads`) — khai báo của mô hình GIỮ NGUYÊN câu chữ cũ (test khớp khai báo).
// Hỏi trong nhóm (`ctx.groupScopeId`) thì công cụ ẩn: Danh bạ không gắn nhóm nên không được lộ cho cả nhóm đọc.

const MAX_PEOPLE = 10;

const inputSchema = z.object({
  name: z.string().describe("Tên hoặc một phần tên, vd 'Lan', 'chi Hoa'"),
});
type FindPeopleInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  people: z.array(z.object({ uid: z.string(), name: z.string(), zalo_name: z.string().nullable(), groups: z.string() })),
});
type FindPeopleOutput = z.infer<typeof outputSchema>;

export const findPeopleTool: ToolDefinition<FindPeopleInput, FindPeopleOutput> = {
  name: "find_people",
  title: "Tìm người trong Danh bạ theo tên",
  description: "Tìm người trong Danh bạ theo tên (không cần dấu). Trả về mã Zalo (uid) và các nhóm người đó đang ở.",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  surfaces: ["mcp_http", "assistant_model"],
  family: "reads",
  assistantErrorShape: "string",
  available: (ctx) => ctx.groupScopeId === undefined && canUse(ctx, "contact", "read"),
  async handler(ctx, input) {
    const name = input.name.trim();
    if (name.length < 2) throw new DataAccessError("invalid_value", "Tên quá ngắn");
    const groupVisible = threadVisibilitySql(ctx, "g");
    const memberVisible = threadVisibilitySql(ctx, "g2");
    const scope = contactScopeOf(ctx);
    let rows: RowDataPacket[];
    try {
      // utf8mb4_unicode_ci không phân biệt dấu: "Lan" khớp "Lân", "hoa" khớp "Hòa"
      [rows] = await ctx.db.query<RowDataPacket[]>(
        `SELECT c.zalo_uid, c.display_name, c.zalo_name,
                GROUP_CONCAT(DISTINCT COALESCE(NULLIF(g.label, ''), g.name) SEPARATOR ', ') AS groups_in
         FROM contact c
         LEFT JOIN group_member gm ON gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL
         LEFT JOIN zalo_group g ON g.id = gm.group_id AND g.thread_type = ? AND ${groupVisible.sql}
         WHERE (c.display_name LIKE ? OR c.zalo_name LIKE ?
            OR c.zalo_uid IN (SELECT gm2.zalo_uid FROM group_member gm2 JOIN zalo_group g2 ON g2.id = gm2.group_id
                              WHERE gm2.display_name LIKE ? AND g2.thread_type = ? AND ${memberVisible.sql}))
           ${scope ? `AND ${scope.sql}` : ""}
         GROUP BY c.id
         LIMIT ${MAX_PEOPLE}`,
        [ConversationType.Group, ...groupVisible.params, `%${name}%`, `%${name}%`, `%${name}%`, ConversationType.Group, ...memberVisible.params, ...(scope?.params ?? [])],
      );
    } catch (error) {
      return translateDbError(error);
    }
    const people = rows.map((row) => ({
      uid: String(row.zalo_uid), name: String(row.display_name || row.zalo_name || ""), zalo_name: row.zalo_name === null ? null : String(row.zalo_name),
      groups: String(row.groups_in ?? ""),
    }));
    return { structured: { people }, summary: `Tìm «${name}»: ${people.length} người.`, rowCount: people.length, entity: "contacts" };
  },
};
