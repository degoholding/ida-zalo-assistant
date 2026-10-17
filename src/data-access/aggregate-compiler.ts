import type { DataAccessContext } from "./data-access-context.js";
import { DataAccessError } from "./data-access-errors.js";
import { columnSql, permittedColumns, type ColumnSpec, type EntityDefinition } from "./entity-definition.js";
import { compileWhere } from "./filter-compiler.js";
import type { QueryRequest } from "./query-dsl-schema.js";

// Gộp nhóm: SELECT <cột nhóm>, COUNT(*) [, SUM(<cột>)] … GROUP BY. Cột nhóm / cột cộng chỉ nhận khóa trong `aggregate` của thực thể.

/** Trần số nhóm trả về; lấy 501 để biết có bị cắt. */
export const MAX_GROUPS = 500;
const AGGREGATE_HINT = "/*+ MAX_EXECUTION_TIME(5000) */";
/** Hệ thống lưu giờ UTC; gộp theo ngày / tháng tính theo giờ VN, không cần bảng múi giờ của MySQL. */
const TO_VN = (sql: string) => `CONVERT_TZ(${sql}, '+00:00', '+07:00')`;

export interface CompiledAggregate {
  kind: "aggregate";
  entity: string;
  sql: string;
  params: unknown[];
  fn: "count" | "sum";
  /** Khóa cột nhóm trong kết quả (đúng tên khóa người gọi gửi) + kiểu để định dạng. */
  groupBy: { key: string; type: ColumnSpec["type"]; bucket?: "day" | "month"; untrusted: boolean }[];
  sumKey?: string;
}

function bucketSql(key: string, column: ColumnSpec, sql: string, bucket: "day" | "month" | undefined): string {
  if (!bucket) return sql;
  if (column.type === "day") return bucket === "day" ? sql : `LEFT(${sql}, 7)`;
  if (column.type !== "date") throw new DataAccessError("invalid_value", `«${key}» không phải cột ngày giờ — không dùng bucket.`);
  return `DATE_FORMAT(${TO_VN(sql)}, '${bucket === "day" ? "%Y-%m-%d" : "%Y-%m"}')`;
}

export function compileAggregate(def: EntityDefinition, ctx: DataAccessContext, request: QueryRequest): CompiledAggregate {
  const aggregate = request.aggregate!;
  const options = def.aggregate;
  if (!options) throw new DataAccessError("invalid_value", `Thực thể ${def.name} không hỗ trợ aggregate.`);
  if (request.fields?.length || request.sort) throw new DataAccessError("invalid_value", "aggregate không dùng cùng fields / sort.");
  if (aggregate.fn !== "count" && aggregate.fn !== "sum") throw new DataAccessError("invalid_value", "aggregate.fn chỉ nhận count hoặc sum.", ["count", "sum"]);
  const allowed = permittedColumns(def, ctx);
  const groupable = options.groupBy.filter((key) => allowed.includes(key));
  const groups = aggregate.group_by ?? [];
  if (groups.length > 2) throw new DataAccessError("invalid_value", "group_by tối đa 2 cột.");
  for (const group of groups) {
    if (!groupable.includes(group.field)) throw new DataAccessError("invalid_field", `Không gộp nhóm theo «${group.field}» ở ${def.name}.`, groupable);
  }
  for (const group of groups) {
    // `bucket` được chọn trong hai mẫu định dạng cố định — không nhận giá trị khác
    if (group.bucket !== undefined && group.bucket !== "day" && group.bucket !== "month") {
      throw new DataAccessError("invalid_value", "bucket chỉ nhận day hoặc month.", ["day", "month"]);
    }
  }
  if (new Set(groups.map((group) => group.field)).size !== groups.length) throw new DataAccessError("invalid_value", "group_by có cột trùng.");
  let sumKey: string | undefined;
  if (aggregate.fn === "sum") {
    sumKey = aggregate.field;
    if (!sumKey || !options.sum.includes(sumKey)) {
      throw new DataAccessError("invalid_field", `fn = sum cần field trong danh sách cộng được của ${def.name}.`, options.sum);
    }
  } else if (aggregate.field) {
    throw new DataAccessError("invalid_value", "Chỉ fn = sum mới có field.");
  }
  const { where } = compileWhere(def, ctx, request);
  const groupExprs = groups.map((group) => bucketSql(group.field, def.columns[group.field], columnSql(def.columns[group.field], ctx), group.bucket));
  const select = [
    ...groups.map((group, index) => `${groupExprs[index]} AS \`${group.field}\``),
    "COUNT(*) AS `count`",
    ...(sumKey ? [`SUM(${columnSql(def.columns[sumKey], ctx)}) AS \`sum\``] : []),
  ].join(", ");
  const orderBy = `ORDER BY \`${sumKey ? "sum" : "count"}\` DESC${groupExprs.map((expr) => `, ${expr}`).join("")}`;
  return {
    kind: "aggregate", entity: def.name, fn: aggregate.fn, sumKey,
    sql: `SELECT ${AGGREGATE_HINT} ${select} FROM ${def.from} ${where.sql}${groupExprs.length ? ` GROUP BY ${groupExprs.join(", ")}` : ""} ${orderBy} LIMIT ${MAX_GROUPS + 1}`,
    params: where.params,
    groupBy: groups.map((group) => ({
      key: group.field, type: group.bucket ? "text" : def.columns[group.field].type, bucket: group.bucket,
      untrusted: Boolean(def.columns[group.field].untrusted),
    })),
  };
}
