import { z } from "zod/v4";
import type { Operator } from "../../web/api/list-query.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { permittedColumns, DEFAULT_CELL_CHARS, type EntityDefinition } from "../entity-definition.js";
import { labelsFor } from "../entity-value-labels.js";
import { findEntity, readableEntities } from "../entity-registry.js";
import { listFilterFields, OPERATORS_BY_TYPE } from "../filter-fields.js";
import { MAX_IN_VALUES, MAX_PAGE_SIZE } from "../query-dsl-schema.js";
import { MAX_GROUPS } from "../aggregate-compiler.js";
import { MAX_RESULT_CHARS } from "../result-envelope.js";
import { UNTRUSTED_NOTICE, type ToolDefinition } from "../tool-definition.js";

// describe_entities: thực thể nào đọc được, trường lọc + phép so + nhãn mã số, cột trả về, sắp xếp, gộp nhóm, trần. Sinh TỰ ĐỘNG
// từ định nghĩa (ListSpec của web) nên không lệch với bộ biên dịch.

const outputSchema = z.object({
  entities: z.array(z.record(z.string(), z.unknown())),
  operators_by_type: z.record(z.string(), z.array(z.string())),
  confidential_included: z.boolean(),
  notices: z.array(z.string()),
});
type DescribeOutput = z.infer<typeof outputSchema>;
type DescribeInput = { entity?: string | undefined };

export function describeEntity(def: EntityDefinition, ctx: DataAccessContext): Record<string, unknown> {
  const spec = def.spec(ctx);
  const fields = permittedColumns(def, ctx);
  const filters = Object.fromEntries(Object.entries(listFilterFields(def, ctx)).map(([name, info]) => {
    const labels = labelsFor(def.name, name);
    return [name, { type: info.type, ops: info.ops, ...(labels ? { values: labels } : {}) }];
  }));
  return {
    name: def.name, title: def.title, access: ["read"], filters, fields, default_fields: def.defaultFields,
    untrusted_fields: fields.filter((key) => def.columns[key].untrusted),
    value_labels: Object.fromEntries(fields.flatMap((key) => { const labels = labelsFor(def.name, key); return labels ? [[key, labels]] : []; })),
    sorts: Object.keys(spec.sorts), default_sort: spec.defaultSort,
    search: spec.search ? true : false,
    required_filter: def.requiredFilter ?? null,
    aggregate: def.aggregate ? { group_by: def.aggregate.groupBy.filter((key) => fields.includes(key)), sum: def.aggregate.sum } : null,
    limits: { max_page_size: MAX_PAGE_SIZE, max_cell_chars: DEFAULT_CELL_CHARS, max_result_chars: MAX_RESULT_CHARS, max_groups: MAX_GROUPS, max_in_values: MAX_IN_VALUES },
    notes: def.notes ?? [],
  };
}

export const describeEntitiesTool: ToolDefinition<DescribeInput, DescribeOutput> = {
  name: "describe_entities",
  title: "Mô tả thực thể dữ liệu",
  description: `Liệt kê các thực thể dữ liệu tài khoản này truy vấn được bằng query_records: trường lọc + phép so, cột trả về, sắp xếp, gộp nhóm, giới hạn. Gọi trước khi lọc. ${UNTRUSTED_NOTICE}`,
  input: (ctx) => {
    const names = readableEntities(ctx).map((def) => def.name);
    return z.object({
      entity: (names.length ? z.enum(names as [string, ...string[]]) : z.string()).optional().describe("Chỉ mô tả thực thể này; bỏ trống = tất cả."),
    });
  },
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  available: (ctx) => readableEntities(ctx).length > 0,
  async handler(ctx, input) {
    const defs = input.entity ? [findEntity(input.entity)].filter((def): def is EntityDefinition => Boolean(def)) : readableEntities(ctx);
    if (input.entity && !readableEntities(ctx).some((def) => def.name === input.entity)) {
      throw new DataAccessError("unknown_entity", `Không có thực thể «${input.entity}».`, readableEntities(ctx).map((def) => def.name));
    }
    const structured: DescribeOutput = {
      entities: defs.map((def) => describeEntity(def, ctx)),
      operators_by_type: Object.fromEntries(Object.entries(OPERATORS_BY_TYPE).map(([type, ops]) => [type, ops as Operator[]])),
      confidential_included: ctx.includeConfidential,
      notices: [],
    };
    return { structured, summary: `${defs.length} thực thể: ${defs.map((def) => def.name).join(", ")}.`, rowCount: defs.length };
  },
};
