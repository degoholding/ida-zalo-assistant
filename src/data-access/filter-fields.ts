import type { FieldSpec, FieldType, Operator } from "../web/api/list-query.js";
import type { DataAccessContext } from "./data-access-context.js";
import type { EntityDefinition } from "./entity-definition.js";

// Trường lọc của một thực thể = `ListSpec.fields` của web (MỘT nguồn sự thật) + phép so cho từng kiểu. Dùng chung cho bộ biên
// dịch (kiểm lời gọi) và `describe_entities` (nói cho mô hình biết).

/** Phép so theo kiểu trường (bảng trong kế hoạch phase 2). */
export const OPERATORS_BY_TYPE: Record<FieldType, Operator[]> = {
  text: ["eq", "ne", "contains", "not_contains", "in", "not_in", "isnull"],
  number: ["eq", "ne", "gt", "gte", "lt", "lte", "between", "in", "not_in", "isnull"],
  date: ["eq", "gt", "gte", "lt", "lte", "between", "isnull"],
  boolean: ["eq", "isnull"],
};

export interface FilterFieldInfo {
  type: FieldType;
  ops: Operator[];
  spec: FieldSpec;
  /** Trường ngày dùng hàm `build` của web: chỉ hiểu «YYYY-MM-DD» (cả ngày), không hiểu giờ. */
  dayOnly: boolean;
}

/** Trường lọc người gọi dùng được, theo khóa. */
export function listFilterFields(def: EntityDefinition, ctx: DataAccessContext): Record<string, FilterFieldInfo> {
  const result: Record<string, FilterFieldInfo> = {};
  for (const [name, spec] of Object.entries(def.spec(ctx).fields)) {
    let ops = OPERATORS_BY_TYPE[spec.type];
    if (spec.build) {
      // Hàm `build` tự viết không biết `isnull`, boolean chỉ có eq — thực thể có thể thu hẹp thêm bằng `filterOps`
      ops = spec.type === "boolean" ? ["eq"] : ops.filter((op) => op !== "isnull");
    }
    ops = def.filterOps?.[name] ?? ops;
    result[name] = { type: spec.type, ops, spec, dayOnly: Boolean(spec.build) && spec.type === "date" };
  }
  return result;
}
