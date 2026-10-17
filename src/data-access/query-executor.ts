import type { RowDataPacket } from "mysql2";
import { canUse, type DataAccessContext } from "./data-access-context.js";
import { DataAccessError, translateDbError } from "./data-access-errors.js";
import { findEntity, readableEntities } from "./entity-registry.js";
import { compileQuery, MAX_COUNTED } from "./query-compiler.js";
import type { QueryRequest } from "./query-dsl-schema.js";
import { shapeGroups, shapeRows, type GroupsResult, type RowsResult } from "./result-envelope.js";

// Chạy một yêu cầu `query_records`: tra thực thể + kiểm quyền → biên dịch → chạy → dựng vỏ kết quả.

const TOTAL_CAPPED_NOTICE = `Tổng số dòng chỉ đếm tới ${MAX_COUNTED.toLocaleString("vi-VN")} — con số thật có thể lớn hơn.`;

export async function runQuery(ctx: DataAccessContext, request: QueryRequest): Promise<RowsResult | GroupsResult> {
  const def = findEntity(request.entity);
  if (!def) throw new DataAccessError("unknown_entity", `Không có thực thể «${request.entity}».`, readableEntities(ctx).map((item) => item.name));
  if (!canUse(ctx, def.permission, "read")) throw new DataAccessError("forbidden", `Không đủ quyền đọc «${def.name}».`);
  const compiled = compileQuery(def, ctx, request);
  try {
    const [rows] = await ctx.db.query<RowDataPacket[]>(compiled.sql, compiled.params);
    if (compiled.kind === "aggregate") return shapeGroups(compiled, rows);
    let total: number | null = null;
    const notices: string[] = [];
    if (compiled.includeTotal) {
      const [counted] = await ctx.db.query<RowDataPacket[]>(compiled.countSql, compiled.countParams);
      const n = Number(counted[0]?.n ?? 0);
      total = Math.min(n, MAX_COUNTED);
      if (n > MAX_COUNTED) notices.push(TOTAL_CAPPED_NOTICE);
    }
    const result = shapeRows(def, compiled, rows, total, ctx.maskPersonal);
    result.notices.push(...notices);
    return result;
  } catch (error) {
    return translateDbError(error);
  }
}
