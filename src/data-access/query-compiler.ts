import type { DataAccessContext } from "./data-access-context.js";
import { DataAccessError } from "./data-access-errors.js";
import { columnSql, permittedColumns, type EntityDefinition } from "./entity-definition.js";
import { compileAggregate, type CompiledAggregate } from "./aggregate-compiler.js";
import { compileWhere } from "./filter-compiler.js";
import { DEFAULT_PAGE_SIZE, MAX_FIELDS, MAX_PAGE_SIZE, type QueryRequest } from "./query-dsl-schema.js";

// Biên dịch một yêu cầu DSL thành SQL tham số hóa. Hàm THUẦN (không chạm DB): kiểm mọi thứ theo danh sách trắng của thực thể,
// tên cột chỉ lấy từ định nghĩa, giá trị luôn qua `?`. `query-executor` chạy kết quả.

/** Gợi ý MySQL tự dừng câu chạy quá 5 giây (cùng trần với màn «Tìm tin»). */
export const QUERY_TIME_HINT = "/*+ MAX_EXECUTION_TIME(5000) */";
/** OFFSET tối đa — đọc sâu hơn thì phải thu hẹp bộ lọc. */
export const MAX_OFFSET = 10_000;
/** Đếm tổng dừng ở đây (câu COUNT không quét hết bảng lớn). */
export const MAX_COUNTED = 10_000;

export interface CompiledRows {
  kind: "rows";
  entity: string;
  sql: string;
  params: unknown[];
  /** Câu đếm tổng (chỉ chạy khi `include_total`). */
  countSql: string;
  countParams: unknown[];
  includeTotal: boolean;
  /** Khóa cột trả về, theo thứ tự yêu cầu. */
  fields: string[];
  pageNumber: number;
  pageSize: number;
}

export type CompiledQuery = CompiledRows | CompiledAggregate;

function pickFields(def: EntityDefinition, ctx: DataAccessContext, requested: string[] | undefined): string[] {
  const allowed = permittedColumns(def, ctx);
  const fields = [...new Set(requested?.length ? requested : def.defaultFields)];
  if (fields.length > MAX_FIELDS) throw new DataAccessError("invalid_value", `Tối đa ${MAX_FIELDS} cột một lần.`);
  const unknown = fields.find((field) => !allowed.includes(field));
  if (unknown !== undefined) throw new DataAccessError("invalid_field", `Không có cột «${unknown}» ở ${def.name}.`, allowed);
  return fields;
}

function pickOrder(def: EntityDefinition, ctx: DataAccessContext, sort: QueryRequest["sort"]): string {
  const spec = def.spec(ctx);
  const key = sort?.field ?? spec.defaultSort.by;
  if (!Object.hasOwn(spec.sorts, key)) {
    throw new DataAccessError("invalid_field", `Không sắp xếp được theo «${key}» ở ${def.name}.`, Object.keys(spec.sorts));
  }
  const dir = sort?.dir ?? (sort ? "asc" : spec.defaultSort.dir);
  // Chiều được ghép thẳng vào SQL — chỉ nhận đúng hai giá trị, kể cả khi bỏ qua bước kiểm của zod
  if (dir !== "asc" && dir !== "desc") throw new DataAccessError("invalid_value", "sort.dir chỉ nhận asc hoặc desc.", ["asc", "desc"]);
  return `ORDER BY ${spec.sorts[key]} ${dir.toUpperCase()}, ${spec.tieBreaker}`;
}

function pickPage(request: QueryRequest): { size: number; number: number; offset: number } {
  const size = request.page?.size ?? DEFAULT_PAGE_SIZE;
  const number = request.page?.number ?? 1;
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) throw new DataAccessError("invalid_value", `page.size phải từ 1 đến ${MAX_PAGE_SIZE}.`);
  if (!Number.isInteger(number) || number < 1) throw new DataAccessError("invalid_value", "page.number phải là số nguyên từ 1.");
  const offset = (number - 1) * size;
  if (offset > MAX_OFFSET) throw new DataAccessError("page_too_deep", `Trang quá sâu (tối đa đọc tới dòng ${MAX_OFFSET}) — thu hẹp bộ lọc hoặc đổi cách sắp xếp.`);
  return { size, number, offset };
}

export function compileQuery(def: EntityDefinition, ctx: DataAccessContext, request: QueryRequest): CompiledQuery {
  if (request.aggregate) return compileAggregate(def, ctx, request);
  const fields = pickFields(def, ctx, request.fields);
  const { where } = compileWhere(def, ctx, request);
  const orderSql = pickOrder(def, ctx, request.sort);
  const page = pickPage(request);
  const select = fields.map((key) => `${columnSql(def.columns[key], ctx)} AS \`${key}\``).join(", ");
  return {
    kind: "rows", entity: def.name,
    sql: `SELECT ${QUERY_TIME_HINT} ${select} FROM ${def.from} ${where.sql} ${orderSql} LIMIT ? OFFSET ?`,
    params: [...where.params, page.size + 1, page.offset],
    countSql: `SELECT ${QUERY_TIME_HINT} COUNT(*) AS n FROM (SELECT 1 FROM ${def.from} ${where.sql} LIMIT ${MAX_COUNTED + 1}) counted`,
    countParams: where.params,
    includeTotal: request.include_total === true,
    fields, pageNumber: page.number, pageSize: page.size,
  };
}
