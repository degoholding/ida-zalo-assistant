import assert from "node:assert/strict";
import { McpCallSource, UserRole } from "../constants.js";
import type { Principal } from "../auth/principal.js";
import type { Db } from "../db/pool.js";
import { buildDataAccessContext, type DataAccessContext } from "./data-access-context.js";
import { DataAccessError, type DataAccessErrorCode } from "./data-access-errors.js";
import { findEntity } from "./entity-registry.js";
import { compileQuery, type CompiledRows } from "./query-compiler.js";
import type { QueryRequest } from "./query-dsl-schema.js";

// Dụng cụ chung cho test của lõi truy cập dữ liệu (không DB thật): principal mẫu theo vai trò, ngữ cảnh, và «DB» giả ghi lại câu
// SQL + trả dòng theo kịch bản. Chỉ test import tệp này.

export const NOW = new Date("2026-10-17T05:00:00Z");

export function principalOf(role: UserRole, overrides: Partial<Principal> = {}): Principal {
  return { userId: 7, tenantId: 1, fullName: "Người thử", email: "thu@example.com", role, groupIds: null, ...overrides };
}

export const admin = (overrides: Partial<Principal> = {}) => principalOf(UserRole.Admin, { userId: 1, fullName: "Quản trị", ...overrides });
export const manager = (overrides: Partial<Principal> = {}) => principalOf(UserRole.Manager, { groupIds: [11, 12], ...overrides });
export const staff = (overrides: Partial<Principal> = {}) => principalOf(UserRole.Staff, { groupIds: [11, 12], ...overrides });

export interface RecordedQuery {
  sql: string;
  params: unknown[];
}

/** DB giả: `reply` trả dòng cho câu SQL (theo thứ tự gọi); mọi câu được ghi vào `queries`. */
export function fakeDb(reply: (sql: string, params: unknown[]) => unknown[] = () => []): { db: Db; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return [reply(sql, params), []];
    },
  } as unknown as Db;
  return { db, queries };
}

export function makeCtx(principal: Principal, overrides: Partial<DataAccessContext> = {}, db: Db = fakeDb().db): DataAccessContext {
  return { ...buildDataAccessContext({ db, principal, maskPersonal: false, source: McpCallSource.Http, now: NOW }), ...overrides };
}

/** Biên dịch yêu cầu DSL thành truy vấn liệt kê dòng (mặc định người gọi là quản trị không cờ Mật). */
export function compileRows(entity: string, request: Partial<QueryRequest> = {}, ctx: DataAccessContext = makeCtx(admin())): CompiledRows {
  const compiled = compileQuery(findEntity(entity)!, ctx, { entity, ...request });
  assert.equal(compiled.kind, "rows");
  return compiled as CompiledRows;
}

/** `run` phải ném `DataAccessError` đúng mã (và đúng nội dung nếu có `pattern`). */
export function rejects(run: () => unknown, code: DataAccessErrorCode, pattern?: RegExp): DataAccessError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof DataAccessError, `cần DataAccessError, nhận ${String(error)}`);
    assert.equal(error.code, code, error.message);
    if (pattern) assert.match(error.message, pattern);
    return error;
  }
  assert.fail(`cần lỗi ${code}`);
}
