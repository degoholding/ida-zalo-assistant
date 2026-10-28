import { z } from "zod/v4";
import { readableEntities } from "../entity-registry.js";
import { buildQueryInputSchema, queryRequestSchema, type QueryRequest } from "../query-dsl-schema.js";
import { runQuery } from "../query-executor.js";
import { UNTRUSTED_NOTICE, type ToolDefinition } from "../tool-definition.js";

// query_records: MỘT công cụ truy vấn chung cho mọi thực thể (lọc / chọn cột / sắp xếp / phân trang / gộp nhóm) — không SQL thô.

const outputSchema = z.object({
  entity: z.string(),
  items: z.array(z.record(z.string(), z.unknown())).optional(),
  page: z.object({ number: z.number(), size: z.number(), has_more: z.boolean(), total: z.number().nullable() }).optional(),
  groups: z.array(z.record(z.string(), z.unknown())).optional(),
  group_count: z.number().optional(),
  untrusted_fields: z.array(z.string()),
  truncated: z.object({ rows: z.boolean().optional(), cells: z.array(z.string()).optional(), groups: z.boolean().optional() }),
  notices: z.array(z.string()),
});
type QueryOutput = z.infer<typeof outputSchema>;

export const queryRecordsTool: ToolDefinition<QueryRequest, QueryOutput> = {
  name: "query_records",
  title: "Truy vấn dữ liệu",
  description:
    "Truy vấn bản ghi theo thực thể (groups, conversations, messages, contacts, files, links, tasks, tickets, send_commands, reply_templates, " +
    "metrics, catalog, audit_log — chỉ những thực thể tài khoản này đọc được). Gọi describe_entities để biết trường lọc, phép so, cột, " +
    "sắp xếp. Lọc bằng filters [{ field, op, value }] nối VÀ; chọn cột bằng fields; gộp nhóm đếm / cộng bằng aggregate. Ngày 'YYYY-MM-DD' " +
    `= cả ngày giờ VN; không ghi múi giờ = giờ VN. Mỗi trang tối đa 100 dòng. ${UNTRUSTED_NOTICE}`,
  input: (ctx) => {
    const names = readableEntities(ctx).map((def) => def.name);
    return names.length ? buildQueryInputSchema(names as [string, ...string[]]) : queryRequestSchema;
  },
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  available: (ctx) => readableEntities(ctx).length > 0,
  async handler(ctx, input) {
    const result = await runQuery(ctx, input);
    const rowCount = "items" in result ? result.items.length : result.groups.length;
    const summary = "items" in result
      ? `${result.entity}: ${rowCount} dòng, trang ${result.page.number}${result.page.has_more ? " (còn trang sau)" : ""}${result.page.total !== null ? `, tổng ${result.page.total}` : ""}.`
      : `${result.entity}: ${rowCount} nhóm${result.truncated.groups ? " (đã cắt)" : ""}.`;
    return { structured: result as QueryOutput, summary, rowCount, entity: result.entity };
  },
};
