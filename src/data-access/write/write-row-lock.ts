import type { PoolConnection } from "mysql2/promise";
import type { Db } from "../../db/pool.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";

// M1 (review phase 8): `confirm_write` dựng lại nháp bằng `prepare` rồi mới `execute` — giữa hai bước một người khác có thể sửa cùng bản ghi
// và bản ghi bị ghi đè mù. Hàm này chạy phần ghi trong MỘT giao dịch: khóa dòng (`SELECT … FOR UPDATE`), dựng lại dấu trạng thái trên
// chính kết nối đó, khác dấu lúc đề xuất thì hủy (rollback) báo `stale_target`; khớp mới chạy phần ghi — cũng trên kết nối giao dịch,
// nên ghi + nhật ký thao tác cùng commit hoặc cùng rollback. Các hàm web (patchContact, editTemplate…) chỉ dùng `db.query`, nhận
// kết nối giao dịch (qua `transactionDb`) thay cho pool được.

export const STALE_MESSAGE = "Bản ghi đã thay đổi từ lúc đề xuất — không ghi đè. Tạo đề xuất mới để xem trạng thái hiện tại.";

export interface LockedWrite<T> {
  /** Câu khóa dòng đích, vd `SELECT id FROM contact WHERE id = ? FOR UPDATE`. */
  lockSql: string;
  lockParams: unknown[];
  /** Dựng lại dấu trạng thái đích (dùng `tx` — ngữ cảnh gắn kết nối giao dịch). */
  currentState: (tx: DataAccessContext) => Promise<string>;
  expectedState: string;
  /** Phần ghi, chạy trên ngữ cảnh giao dịch. */
  run: (tx: DataAccessContext) => Promise<T>;
}

/**
 * «Db» gắn vào MỘT kết nối đang trong giao dịch: `query` / `execute` đi qua kết nối; `getConnection` (vd setContactTags tự mở giao dịch
 * riêng) trả bản dùng chung cùng kết nối với begin / commit / rollback / release rỗng — giao dịch ngoài mới là chỗ commit / rollback thật.
 */
function transactionDb(connection: PoolConnection): Db {
  const shared = {
    query: connection.query.bind(connection), execute: connection.execute.bind(connection),
    beginTransaction: async () => undefined, commit: async () => undefined, rollback: async () => undefined, release: () => undefined,
  };
  return { ...shared, getConnection: async () => shared } as unknown as Db;
}

export async function runLockedWrite<T>(ctx: DataAccessContext, write: LockedWrite<T>): Promise<T> {
  const connection = await ctx.db.getConnection();
  try {
    await connection.beginTransaction();
    const tx: DataAccessContext = { ...ctx, db: transactionDb(connection) };
    await connection.query(write.lockSql, write.lockParams);
    if ((await write.currentState(tx)) !== write.expectedState) throw new DataAccessError("stale_target", STALE_MESSAGE);
    const result = await write.run(tx);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}
