import { buildConditionFromValues, escapeLikeText, type FieldType, type Operator, type SqlPart } from "../web/api/list-query.js";
import { combineWhere } from "../web/api/list-runner.js";
import type { DataAccessContext } from "./data-access-context.js";
import { DataAccessError } from "./data-access-errors.js";
import { buildDateCondition, dateBounds } from "./date-condition.js";
import type { EntityDefinition } from "./entity-definition.js";
import { assertNoPersonalNumberProbe } from "./masked-filter-guard.js";
import { listFilterFields, type FilterFieldInfo } from "./filter-fields.js";
import { MAX_IN_VALUES, type QueryFilter, type QueryRequest } from "./query-dsl-schema.js";
import { parseVnInstant, spanDays, type ParsedInstant } from "./vn-time.js";

// Dịch `filters` + `search` của DSL thành SQL tham số hóa: kiểm trường / phép so / kiểu giá trị theo danh sách trắng của
// thực thể, rồi ghép với điều kiện cố định (`baseWhere`: phạm vi + Mật) bằng `combineWhere` của web.

const MAX_TEXT_VALUE = 500;
const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;

type RawValue = QueryFilter["value"];

const invalid = (field: string, message: string) => new DataAccessError("invalid_value", `«${field}»: ${message}`);

function toText(field: string, raw: unknown): string {
  const text = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : raw;
  if (typeof text !== "string") throw invalid(field, "cần một chuỗi chữ.");
  if (text.length > MAX_TEXT_VALUE) throw invalid(field, `dài quá ${MAX_TEXT_VALUE} ký tự.`);
  return text;
}

function toNumberText(field: string, raw: unknown): string {
  const value = typeof raw === "number" ? raw : typeof raw === "string" && NUMBER_TEXT.test(raw.trim()) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) throw invalid(field, "cần một số.");
  return String(value);
}

function toBooleanText(field: string, raw: unknown): string {
  if (raw === true || raw === "true" || raw === "1" || raw === 1) return "1";
  if (raw === false || raw === "false" || raw === "0" || raw === 0) return "0";
  throw invalid(field, "cần true hoặc false.");
}

function toInstant(field: string, raw: unknown, dayOnly: boolean): ParsedInstant {
  const parsed = typeof raw === "string" ? parseVnInstant(raw) : null;
  if (!parsed) throw invalid(field, "ngày không hợp lệ — dùng 'YYYY-MM-DD' hoặc ISO 8601 (không ghi múi giờ = giờ VN).");
  if (dayOnly && !parsed.dayOnly) throw invalid(field, "trường này chỉ lọc theo ngày — dùng 'YYYY-MM-DD'.");
  return parsed;
}

/** Danh sách giá trị đã kiểm số lượng theo phép so: in / not_in = 1..200, between = đúng 2, còn lại đúng 1 giá trị đơn. */
function listValues(field: string, operator: Operator, value: RawValue): unknown[] {
  const multi = operator === "in" || operator === "not_in" || operator === "between";
  if (!multi) {
    if (value === undefined || Array.isArray(value)) throw invalid(field, `phép «${operator}» cần một giá trị đơn.`);
    return [value];
  }
  if (!Array.isArray(value)) throw invalid(field, `phép «${operator}» cần một mảng giá trị.`);
  if (operator === "between" && value.length !== 2) throw invalid(field, "between cần đúng 2 giá trị [từ, đến].");
  if (value.length === 0) throw invalid(field, "mảng giá trị rỗng.");
  if (value.length > MAX_IN_VALUES) throw invalid(field, `tối đa ${MAX_IN_VALUES} giá trị.`);
  return value;
}

interface CompiledFilter {
  condition: SqlPart;
  /** Trường được ràng bằng eq / in — thỏa «bộ lọc bắt buộc» dạng trường thường. */
  pinned: boolean;
  bounds?: { lower?: Date; upper?: Date };
}

function compileOne(ctx: DataAccessContext, name: string, info: FilterFieldInfo, filter: QueryFilter): CompiledFilter {
  const operator = filter.op as Operator;
  const column = info.spec.sql;
  if (operator === "isnull") {
    const wanted = filter.value === undefined ? true : filter.value;
    if (typeof wanted !== "boolean" || !column) throw invalid(name, "isnull cần true hoặc false.");
    return { condition: { sql: `${column} IS ${wanted ? "" : "NOT "}NULL`, params: [] }, pinned: false };
  }
  const raw = listValues(name, operator, filter.value);
  const convert: Record<FieldType, (value: unknown) => string> = {
    text: (value) => toText(name, value), number: (value) => toNumberText(name, value), boolean: (value) => toBooleanText(name, value),
    date: () => "",
  };
  if (info.type === "date") {
    const instants = raw.map((value) => toInstant(name, value, info.dayOnly));
    const condition = info.spec.build
      ? buildConditionFromValues(info.spec, operator, instants.map(rawDay))
      : column ? buildDateCondition(column, operator, instants) : null;
    if (!condition) throw invalid(name, "giá trị không dùng được với phép so này.");
    return { condition, pinned: false, bounds: dateBounds(operator, instants) };
  }
  const values = raw.map(convert[info.type]);
  // Tìm chuỗi con trong chữ: khi che dữ liệu cá nhân bật, không cho dò số (xem masked-filter-guard)
  if (operator === "contains" || operator === "not_contains") values.forEach((value) => assertNoPersonalNumberProbe(ctx, name, value));
  const condition = buildConditionFromValues(info.spec, operator, values);
  if (!condition) throw invalid(name, "giá trị không dùng được với phép so này.");
  return { condition, pinned: operator === "eq" || operator === "in", bounds: undefined };
}

/** Hàm `build` của web đọc «YYYY-MM-DD» (giờ VN): lấy lại đúng ngày VN của mốc đã kiểm. */
function rawDay(item: ParsedInstant): string {
  return new Date(item.date.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

export interface CompiledWhere {
  /** Câu `WHERE …` đầy đủ (điều kiện cố định + bộ lọc). */
  where: SqlPart;
}

/** Lọc + tìm nhanh + kiểm «bộ lọc bắt buộc». Ném `DataAccessError` kèm danh sách hợp lệ khi sai. */
export function compileWhere(def: EntityDefinition, ctx: DataAccessContext, request: QueryRequest): CompiledWhere {
  const fields = listFilterFields(def, ctx);
  const conditions: SqlPart[] = [];
  const pinned = new Set<string>();
  const bounds = new Map<string, { lower?: Date; upper?: Date }>();
  for (const filter of request.filters ?? []) {
    if (!Object.hasOwn(fields, filter.field)) {
      throw new DataAccessError("invalid_field", `Không lọc được theo «${filter.field}» ở ${def.name}.`, Object.keys(fields));
    }
    const info = fields[filter.field];
    if (!(info.ops as string[]).includes(filter.op)) {
      throw new DataAccessError("invalid_operator", `Trường «${filter.field}» (${info.type}) không nhận phép «${filter.op}».`, info.ops);
    }
    const compiled = compileOne(ctx, filter.field, info, filter);
    conditions.push(compiled.condition);
    if (compiled.pinned) pinned.add(filter.field);
    if (compiled.bounds) {
      const old = bounds.get(filter.field) ?? {};
      // Nhiều điều kiện cùng trường nối VÀ: lấy cận chặt nhất
      const lower = [old.lower, compiled.bounds.lower].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
      const upper = [old.upper, compiled.bounds.upper].filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0];
      bounds.set(filter.field, { lower, upper });
    }
  }
  const search = request.search?.trim();
  if (search) {
    const spec = def.spec(ctx).search;
    if (!spec) throw new DataAccessError("invalid_value", `Thực thể ${def.name} không hỗ trợ «search» — dùng filters.`);
    assertNoPersonalNumberProbe(ctx, "search", search);
    const like = `%${escapeLikeText(search)}%`;
    conditions.push({ sql: spec.columns.map((column) => `${column} LIKE ?`).join(" OR "), params: spec.columns.map(() => like) });
  }
  assertRequiredFilter(def, ctx, fields, pinned, bounds);
  const filter: SqlPart = conditions.length
    ? { sql: `WHERE ${conditions.map((item) => `(${item.sql})`).join(" AND ")}`, params: conditions.flatMap((item) => item.params) }
    : { sql: "", params: [] };
  return { where: combineWhere(def.baseWhere(ctx), filter) };
}

function assertRequiredFilter(
  def: EntityDefinition, ctx: DataAccessContext, fields: Record<string, FilterFieldInfo>,
  pinned: Set<string>, bounds: Map<string, { lower?: Date; upper?: Date }>,
): void {
  const required = def.requiredFilter;
  if (!required) return;
  let widest = 0;
  for (const name of required.anyOf) {
    if (fields[name]?.type !== "date") {
      if (pinned.has(name)) return;
      continue;
    }
    const range = bounds.get(name);
    if (!range?.lower) continue;
    // Chỉ có cận dưới thì khoảng kéo tới bây giờ
    const days = spanDays(range.lower, range.upper ?? ctx.now);
    if (required.maxRangeDays === undefined || days <= required.maxRangeDays) return;
    widest = Math.max(widest, days);
  }
  if (widest > 0) {
    throw new DataAccessError("range_too_wide", `Khoảng ngày ${widest} ngày quá rộng cho ${def.name} — tối đa ${required.maxRangeDays} ngày (hoặc lọc theo ${required.anyOf.filter((n) => fields[n]?.type !== "date").join(" / ") || "trường khác"}).`);
  }
  const limit = required.maxRangeDays ? ` (khoảng ngày tối đa ${required.maxRangeDays} ngày, chặn cả hai đầu)` : "";
  throw new DataAccessError("missing_required_filter", `${def.name} là bảng lớn — bắt buộc lọc theo ${required.anyOf.join(" hoặc ")}${limit}.`, required.anyOf);
}
