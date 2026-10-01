// Bộ máy danh sách dùng chung — tương ứng `apply_filters` + `pagination` của backend ERP.
// Màn danh sách nào cũng chỉ KHAI BÁO (trường lọc được, cột sắp xếp được, cột tìm kiếm); bộ máy
// dịch tham số URL thành SQL có tham số hóa, đếm tổng, phân trang.
//
// Tham số do giao diện `web/` (khung CrudListPage + conditional-filter của ERP) gửi lên:
//   page, page_size, sort_by, sort_dir, <search>=…, <trường>=<giá trị> (lọc nhanh),
//   <trường>__<eq|ne|contains|not_contains|gt|gte|lt|lte|between|in|not_in|isnull>=…, conjunction=or
//
// ⚠️ Trường KHÔNG khai trong `fields` thì bỏ qua im lặng (giống ERP: người dùng sửa tay URL không
// làm vỡ trang). Muốn lọc theo trường mới thì phải khai ở đây — đó cũng là chỗ chặn SQL lạ lọt vào.

export type FieldType = "text" | "number" | "date" | "boolean";

export interface FieldSpec {
  /** Biểu thức SQL của cột (vd `c.kind`). Bỏ trống nếu dùng `build`. */
  sql?: string;
  type: FieldType;
  /** Điều kiện tự viết (vd EXISTS qua bảng khác) — nhận phép so + danh sách giá trị đã tách. */
  build?: (operator: Operator, values: string[]) => SqlPart | null;
}

export type Operator = "eq" | "ne" | "contains" | "not_contains" | "gt" | "gte" | "lt" | "lte" | "between" | "in" | "not_in" | "isnull";

export interface SqlPart {
  sql: string;
  params: unknown[];
}

export interface ListSpec {
  fields: Record<string, FieldSpec>;
  /** Khóa sắp xếp → biểu thức SQL (chiều asc/desc ghép sau). */
  sorts: Record<string, string>;
  defaultSort: { by: string; dir: "asc" | "desc" };
  /** Cột phụ cuối ORDER BY để thứ tự ổn định giữa các trang (vd `c.id`). */
  tieBreaker: string;
  /** Tên tham số ô tìm và các cột nó tìm (LIKE %…%). */
  search?: { param: string; columns: string[] };
}

export interface ListRequest {
  where: SqlPart;
  orderSql: string;
  page: number;
  pageSize: number;
  offset: number;
}

const OPERATORS = new Set<Operator>(["eq", "ne", "contains", "not_contains", "gt", "gte", "lt", "lte", "between", "in", "not_in", "isnull"]);
const RESERVED = new Set(["page", "page_size", "sort_by", "sort_dir", "conjunction"]);
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 20;
const MAX_IN_VALUES = 200;

function parseValue(type: FieldType, raw: string): unknown {
  switch (type) {
    case "number": {
      const value = Number(raw);
      return Number.isFinite(value) ? value : undefined;
    }
    case "boolean":
      return ["1", "true", "yes"].includes(raw.toLowerCase()) ? 1 : ["0", "false", "no"].includes(raw.toLowerCase()) ? 0 : undefined;
    case "date": {
      const value = new Date(raw);
      return Number.isNaN(value.getTime()) ? undefined : value;
    }
    default:
      return raw;
  }
}

/** Một điều kiện cho một trường; giá trị không hợp lệ (số sai, ngày sai) → bỏ điều kiện đó. */
export function buildCondition(field: FieldSpec, operator: Operator, rawValue: string): SqlPart | null {
  const values = operator === "in" || operator === "not_in" || operator === "between"
    ? rawValue.split(",").map((value) => value.trim()).filter((value) => value !== "").slice(0, MAX_IN_VALUES)
    : [rawValue];
  if (field.build) return field.build(operator, values);
  const column = field.sql;
  if (!column) return null;
  if (operator === "isnull") {
    return { sql: rawValue.toLowerCase() === "true" ? `${column} IS NULL` : `${column} IS NOT NULL`, params: [] };
  }
  const parsed = values.map((value) => parseValue(field.type, value));
  if (!parsed.length || parsed.some((value) => value === undefined)) return null;
  switch (operator) {
    case "eq": return { sql: `${column} = ?`, params: [parsed[0]] };
    case "ne": return { sql: `${column} <> ?`, params: [parsed[0]] };
    case "contains": return { sql: `${column} LIKE ?`, params: [`%${values[0]}%`] };
    case "not_contains": return { sql: `${column} NOT LIKE ?`, params: [`%${values[0]}%`] };
    case "gt": return { sql: `${column} > ?`, params: [parsed[0]] };
    case "gte": return { sql: `${column} >= ?`, params: [parsed[0]] };
    case "lt": return { sql: `${column} < ?`, params: [parsed[0]] };
    case "lte": return { sql: `${column} <= ?`, params: [parsed[0]] };
    case "between":
      return parsed.length === 2 ? { sql: `${column} BETWEEN ? AND ?`, params: [parsed[0], parsed[1]] } : null;
    case "in": return { sql: `${column} IN (?)`, params: [parsed] };
    case "not_in": return { sql: `${column} NOT IN (?)`, params: [parsed] };
    default: return null;
  }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function parseListRequest(params: URLSearchParams, spec: ListSpec): ListRequest {
  const conditions: SqlPart[] = [];
  for (const [key, rawValue] of params) {
    if (RESERVED.has(key) || rawValue === "") continue;
    if (spec.search && key === spec.search.param) {
      const like = `%${rawValue.trim()}%`;
      conditions.push({ sql: `(${spec.search.columns.map((column) => `${column} LIKE ?`).join(" OR ")})`,
        params: spec.search.columns.map(() => like) });
      continue;
    }
    const [name, suffix] = key.split("__");
    const field = spec.fields[name];
    if (!field) continue;
    // Tham số trần (lọc nhanh): chữ → chứa, còn lại → bằng — cùng nghĩa với ERP
    const operator = (suffix ?? (field.type === "text" ? "contains" : "eq")) as Operator;
    if (!OPERATORS.has(operator)) continue;
    const condition = buildCondition(field, operator, rawValue);
    if (condition) conditions.push(condition);
  }
  const joiner = params.get("conjunction") === "or" && conditions.length > 1 ? " OR " : " AND ";
  const where: SqlPart = conditions.length
    ? { sql: `WHERE ${conditions.map((condition) => `(${condition.sql})`).join(joiner)}`, params: conditions.flatMap((condition) => condition.params) }
    : { sql: "", params: [] };

  const requestedSort = params.get("sort_by") ?? "";
  const sortBy = spec.sorts[requestedSort] ? requestedSort : spec.defaultSort.by;
  const dirParam = params.get("sort_dir");
  const dir = sortBy === requestedSort && (dirParam === "asc" || dirParam === "desc") ? dirParam : spec.defaultSort.dir;
  const orderSql = `ORDER BY ${spec.sorts[sortBy]} ${dir.toUpperCase()}, ${spec.tieBreaker}`;

  const pageSize = clampInt(params.get("page_size"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const page = clampInt(params.get("page"), 1, 1, 1_000_000);
  return { where, orderSql, page, pageSize, offset: (page - 1) * pageSize };
}
