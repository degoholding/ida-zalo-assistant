import type { Entity } from "../auth/principal.js";
import type { FieldType, ListSpec, Operator, SqlPart } from "../web/api/list-query.js";
import { canUse, type DataAccessContext } from "./data-access-context.js";

// Khai báo MỘT thực thể truy vấn được qua DSL. Tên cột SQL chỉ nằm ở đây (danh sách trắng) — lời gọi của AI chỉ chọn theo
// KHÓA; giá trị luôn đi qua tham số `?`.

/** `day` = cột DATE đã `DATE_FORMAT` thành «YYYY-MM-DD» (không dính múi giờ). */
export type ColumnType = FieldType | "day";

export interface ColumnSpec {
  /** Biểu thức SQL (vd `g.name`, `COALESCE(a.stored_bytes, 0)`); hệ thống tự thêm `AS <khóa>`. */
  sql: string;
  /** Biểu thức SQL phụ thuộc người gọi (vd đếm nhóm CHỈ trong phạm vi + không Mật); có thì thay `sql` — luôn lấy qua `columnSql`. */
  sqlFor?: (ctx: DataAccessContext) => string;
  type: ColumnType;
  /** Nội dung do NGƯỜI NGOÀI viết (tin, ghi chú, tên tệp, chữ trong tệp…) — đánh dấu `untrusted`, cắt ô. */
  untrusted?: boolean;
  /** Trần ký tự của ô chữ này; mặc định `DEFAULT_CELL_CHARS`. */
  maxChars?: number;
  /** Cột cần thêm quyền (vd SĐT cần `catalog.read`); thiếu quyền thì cột không có trong danh sách. */
  requires?: [Entity, "read" | "write"];
}

export interface RequiredFilter {
  /** Phải có ít nhất MỘT trường trong danh sách: trường thường cần `eq`/`in`, trường ngày cần khoảng có chặn hai đầu. */
  anyOf: string[];
  /** Khoảng ngày tối đa (ngày) của trường ngày ở `anyOf`. */
  maxRangeDays?: number;
}

export interface EntityDefinition {
  name: string;
  title: string;
  /** Quyền vai trò cần để đọc (`audit` = quản trị hoặc `can_view_audit`). */
  permission: Entity;
  /** Phần sau FROM (kèm JOIN) — alias phải khớp `ListSpec` của thực thể. */
  from: string;
  /** Trường lọc + cột sắp xếp — tái dùng `*_LIST_SPEC` của web; có thể chọn theo người gọi (SĐT). */
  spec(ctx: DataAccessContext): ListSpec;
  /** Ghi đè phép so cho trường `build` (hàm tự viết chỉ hiểu một số phép). */
  filterOps?: Record<string, Operator[]>;
  columns: Record<string, ColumnSpec>;
  defaultFields: string[];
  /** Phạm vi dòng + Mật + điều kiện cố định. KHÔNG mang chữ WHERE. */
  baseWhere(ctx: DataAccessContext): SqlPart | undefined;
  requiredFilter?: RequiredFilter;
  /** Khóa cột được gộp nhóm / cộng. Không khai = không gộp nhóm. */
  aggregate?: { groupBy: string[]; sum: string[] };
  notes?: string[];
}

/** Trần ký tự mỗi ô chữ khi không khai `maxChars`. */
export const DEFAULT_CELL_CHARS = 2000;
/** Khóa cột / khóa lọc chỉ gồm chữ thường, số, gạch dưới — an toàn để ghép làm bí danh SQL. */
export const SAFE_KEY = /^[a-z][a-z0-9_]*$/;

/** Khóa cột người gọi được chọn (đã loại cột cần quyền riêng mà họ không có). */
export function permittedColumns(def: EntityDefinition, ctx: DataAccessContext): string[] {
  return Object.entries(def.columns)
    .filter(([, column]) => !column.requires || canUse(ctx, column.requires[0], column.requires[1]))
    .map(([key]) => key);
}

/** Biểu thức SQL của cột cho người gọi `ctx` (`sqlFor` nếu có, không thì `sql`). */
export function columnSql(column: ColumnSpec, ctx: DataAccessContext): string {
  return column.sqlFor ? column.sqlFor(ctx) : column.sql;
}
