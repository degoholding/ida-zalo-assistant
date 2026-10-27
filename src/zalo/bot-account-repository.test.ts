import assert from "node:assert/strict";
import { test } from "node:test";
import { BotAccountKind, NEW_ACCOUNT_KIND } from "../constants.js";
import type { Db } from "../db/pool.js";
import { saveLoggedInAccount } from "./bot-account-repository.js";

function captureDb(): { db: Db; calls: { sql: string; params: unknown[] }[] } {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = { query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return [{ insertId: 7 }]; } };
  return { db: db as unknown as Db, calls };
}

test("tài khoản mới quét QR mặc định là Chỉ thu thập (chốt 27/10/2026)", async () => {
  assert.equal(NEW_ACCOUNT_KIND, BotAccountKind.Normal);
  const { db, calls } = captureDb();
  assert.equal(await saveLoggedInAccount(db, "bot-2", "uid-1", "Tên", "cipher"), 7);
  const [{ sql, params }] = calls;
  const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((column) => column.trim());
  // Cột kind phải nằm trong lệnh chèn và nhận đúng NEW_ACCOUNT_KIND — không trông vào mặc định 0 (Trợ lý) của cột DB
  assert.ok(columns.includes("kind"), sql);
  assert.equal(params[params.length - 1], BotAccountKind.Normal);
});

test("quét lại QR cho tài khoản đã có KHÔNG đổi loại: nhánh cập nhật không đụng cột kind", async () => {
  const { db, calls } = captureDb();
  await saveLoggedInAccount(db, "bot-1", "uid-1", "Tên", "cipher");
  const updateClause = calls[0].sql.split("ON DUPLICATE KEY UPDATE")[1] ?? "";
  assert.ok(updateClause.length > 0, "phải có nhánh cập nhật theo nhãn");
  assert.doesNotMatch(updateClause, /\bkind\b/);
});
