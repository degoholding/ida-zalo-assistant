import type { RowDataPacket } from "mysql2";
import type { Db } from "../../db/pool.js";
import { parseListRequest, type ListSpec, type SqlPart } from "./list-query.js";

// Chạy một màn danh sách: dịch tham số (list-query) → đếm tổng → lấy một trang → trang trí từng dòng.
// Mọi `*-api.ts` gọi hàm này thay vì tự viết COUNT + LIMIT, nên phân trang / lọc / sắp xếp đồng bộ.

export interface ListQuery {
  /** Danh sách cột sau SELECT. */
  select: string;
  /** Phần FROM … JOIN …. */
  from: string;
  /** Điều kiện CỐ ĐỊNH của màn (vd chỉ lấy nhóm, không lấy cuộc riêng) — AND với bộ lọc người dùng. */
  baseWhere?: SqlPart;
  /** Gắn thêm dữ liệu cho cả trang một lượt (thẻ, ảnh…) — tránh N+1. */
  decorate?: (rows: RowDataPacket[]) => Promise<unknown[]> | unknown[];
}

export interface ListResult {
  total: number;
  items: unknown[];
}

export function combineWhere(base: SqlPart | undefined, filter: SqlPart): SqlPart {
  if (!base) return filter;
  if (!filter.sql) return { sql: `WHERE ${base.sql}`, params: base.params };
  // Bộ lọc người dùng có thể nối bằng OR — bọc ngoặc để không «thoát» khỏi điều kiện cố định
  return { sql: `WHERE (${base.sql}) AND (${filter.sql.replace(/^WHERE /, "")})`, params: [...base.params, ...filter.params] };
}

export async function runList(db: Db, params: URLSearchParams, spec: ListSpec, query: ListQuery): Promise<ListResult> {
  const request = parseListRequest(params, spec);
  const where = combineWhere(query.baseWhere, request.where);
  const [countRows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n ${query.from} ${where.sql}`, where.params);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${query.select} ${query.from} ${where.sql} ${request.orderSql} LIMIT ? OFFSET ?`,
    [...where.params, request.pageSize, request.offset],
  );
  return { total: Number(countRows[0].n), items: query.decorate ? await query.decorate(rows) : rows };
}
