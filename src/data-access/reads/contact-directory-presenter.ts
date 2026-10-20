import type { RowDataPacket } from "mysql2";
import { z } from "zod/v4";
import { ContactKind, ContactKindSource } from "../../constants.js";
import { canUse } from "../data-access-context.js";
import { translateDbError } from "../data-access-errors.js";
import type { ToolDefinition } from "../tool-definition.js";
import { contactScopeOf } from "./contact-scope-of-actor.js";

// list_contacts (mặt trợ lý): đếm / liệt kê người trong Danh bạ theo loại (khách hàng, nhân sự), chỉ đọc. Mặc định chỉ tính người «đang làm việc với bot»:
// thành viên các nhóm bot ĐANG ĐỌC + người từng nhắn riêng — Danh bạ còn có thành viên mọi nhóm bot ở (kể cả nhóm không đọc), đếm cả thì ra số ảo.
// Loại do hệ thống tự gán (suy theo loại nhóm, chưa ai xác nhận) được tách riêng để mô hình nói rõ độ tin cậy. Phạm vi Danh bạ theo người hỏi
// (`contactScopeOf`: người bị khoanh nhóm chỉ đếm người ở nhóm của mình). Hỏi trong nhóm thì công cụ ẩn (Danh bạ không gắn nhóm).

const MAX_PEOPLE = 50;
const KIND_BY_NAME: Record<string, ContactKind> = { customer: ContactKind.Customer, staff: ContactKind.Staff, unclassified: ContactKind.Unclassified };
const KIND_LABEL: Record<number, string> = {
  [ContactKind.Customer]: "khách hàng", [ContactKind.Staff]: "nhân sự", [ContactKind.Unclassified]: "chưa phân loại",
};

const inputSchema = z.object({
  kind: z.enum(["all", "customer", "staff", "unclassified"]).optional().describe("Loại người; mặc định all"),
  query: z.string().optional().describe("Một phần tên người hoặc tên công ty (tùy chọn)"),
  scope: z.enum(["active", "everyone"]).optional()
    .describe("active (mặc định): nhóm bot đang đọc + người nhắn riêng; everyone: cả thành viên các nhóm KHÔNG đọc — chỉ dùng khi người hỏi nói rõ"),
});
type ListContactsInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  scope: z.string(),
  total_matching: z.number(),
  by_kind: z.record(z.string(), z.object({ total: z.number(), set_by_admin: z.number(), auto_guessed: z.number() })),
  note: z.string(),
  people: z.array(z.object({ name: z.string(), kind: z.string(), classified: z.string(), company: z.string(), groups: z.number() })),
  people_truncated: z.boolean(),
});
type ListContactsOutput = z.infer<typeof outputSchema>;

export const contactDirectoryPresenterTool: ToolDefinition<ListContactsInput, ListContactsOutput> = {
  name: "list_contacts",
  title: "Đếm / liệt kê người trong Danh bạ",
  description:
    "Đếm và liệt kê người trong Danh bạ theo loại (khách hàng / nhân sự / chưa phân loại), kèm công ty và số nhóm. Dùng cho câu " +
    "«có bao nhiêu khách hàng», «danh sách nhân sự», «khách hàng của công ty X». Mặc định chỉ tính người trong các nhóm bot đang đọc " +
    "và người từng nhắn riêng. Kết quả tách số người được quản trị phân loại tay và số tự gán — phải nói rõ với người hỏi.",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_model"],
  family: "reads",
  assistantErrorShape: "string",
  available: (ctx) => ctx.groupScopeId === undefined && canUse(ctx, "contact", "read"),
  async handler(ctx, input) {
    const kind = input.kind !== undefined && input.kind in KIND_BY_NAME ? KIND_BY_NAME[input.kind] : null;
    const mode = input.scope === "everyone" ? "everyone" : "active";
    const query = (input.query ?? "").trim().slice(0, 100);
    const scope = contactScopeOf(ctx);
    const where = ["1 = 1"];
    const params: unknown[] = [];
    if (scope) {
      where.push(scope.sql);
      params.push(...scope.params);
    }
    if (mode === "active") {
      where.push(`(c.last_dm_at IS NOT NULL OR EXISTS (
        SELECT 1 FROM group_member gm JOIN zalo_group g ON g.id = gm.group_id
        WHERE gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL AND g.read_messages = 1))`);
    }
    if (query) {
      where.push("(c.display_name LIKE ? OR c.zalo_name LIKE ? OR co.name LIKE ?)");
      params.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    const from = `FROM contact c LEFT JOIN company co ON co.id = c.company_id WHERE ${where.join(" AND ")}`;
    let counts: RowDataPacket[];
    let people: RowDataPacket[];
    try {
      [counts] = await ctx.db.query<RowDataPacket[]>(`SELECT c.kind, c.kind_source, COUNT(*) AS n ${from} GROUP BY c.kind, c.kind_source`, params);
      [people] = await ctx.db.query<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(c.display_name, ''), c.zalo_name) AS name, c.kind, c.kind_source, co.name AS company,
                (SELECT COUNT(*) FROM group_member gm WHERE gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL) AS \`groups\`
         ${from} ${kind === null ? "" : "AND c.kind = ?"} ORDER BY c.kind_source DESC, name LIMIT ?`,
        [...params, ...(kind === null ? [] : [kind]), MAX_PEOPLE],
      );
    } catch (error) {
      return translateDbError(error);
    }
    const byKind: ListContactsOutput["by_kind"] = {};
    for (const row of counts) {
      const label = KIND_LABEL[row.kind] ?? `loại ${row.kind}`;
      const bucket = (byKind[label] ??= { total: 0, set_by_admin: 0, auto_guessed: 0 });
      bucket.total += Number(row.n);
      if (row.kind_source === ContactKindSource.Manual) bucket.set_by_admin += Number(row.n);
      else bucket.auto_guessed += Number(row.n);
    }
    const matching = kind === null ? Object.values(byKind).reduce((sum, bucket) => sum + bucket.total, 0) : byKind[KIND_LABEL[kind]]?.total ?? 0;
    const structured: ListContactsOutput = {
      scope: mode === "active" ? "người trong các nhóm bot đang đọc + người từng nhắn riêng bot" : "mọi người bot từng thấy (cả nhóm không đọc)",
      total_matching: matching,
      by_kind: byKind,
      note: "auto_guessed = hệ thống tự gán theo loại nhóm, chưa ai xác nhận — nhắc người hỏi vào Danh bạ chỉnh nếu cần số chính xác.",
      people: people.map((row) => ({
        name: String(row.name ?? ""), kind: KIND_LABEL[row.kind] ?? String(row.kind),
        classified: row.kind_source === ContactKindSource.Manual ? "quản trị đặt" : "tự gán", company: String(row.company ?? ""), groups: Number(row.groups),
      })),
      people_truncated: matching > people.length,
    };
    return { structured, summary: `Danh bạ: ${matching} người khớp.`, rowCount: people.length, entity: "contacts" };
  },
};
