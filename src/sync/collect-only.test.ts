import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "../db/pool.js";
import { collectOnlyThreadSql, isCollectOnlyThread, processableThreadSql } from "./collect-only.js";

test("SQL «chỉ lưu»: nhóm dính — từng có bot Normal (bỏ qua left_at) và không có bot Trợ lý đang ở, cuộc riêng xét theo bot chủ cuộc", () => {
  const sql = collectOnlyThreadSql("g");
  assert.match(sql, /g\.thread_type = 0/);
  assert.match(sql, /cod\.id = g\.owner_bot_id AND cod\.kind = 1/);
  assert.match(sql, /cob\.group_id = g\.id AND coa\.kind = 1\)/, "phía Normal không lọc left_at");
  assert.match(sql, /cob\.group_id = g\.id AND cob\.left_at IS NULL AND coa\.kind = 0/, "phía Trợ lý chỉ tính bot còn ở");
  assert.match(sql, /AND NOT EXISTS/);
  assert.match(sql, /coa\.kind = 0/);
});

test("alias tùy chọn được áp vào mọi cột; processableThreadSql là phủ định", () => {
  assert.doesNotMatch(collectOnlyThreadSql("zg"), /[^z]g\./);
  assert.match(collectOnlyThreadSql("zg"), /zg\.owner_bot_id/);
  assert.equal(processableThreadSql("zg"), `NOT ${collectOnlyThreadSql("zg")}`);
});

test("isCollectOnlyThread đọc cột collect_only; cuộc không có thì false", async () => {
  const fake = (rows: unknown[]) => ({ query: async () => [rows] }) as unknown as Db;
  assert.equal(await isCollectOnlyThread(fake([{ collect_only: 1 }]), 1), true);
  assert.equal(await isCollectOnlyThread(fake([{ collect_only: 0 }]), 1), false);
  assert.equal(await isCollectOnlyThread(fake([]), 1), false);
});

test("tài khoản Chỉ thu thập: cuộc mới (nhóm khách, nhóm nội bộ, chat riêng) luôn ĐỌC dù cài đặt tắt; cờ lấy tệp theo cài đặt", async () => {
  const { newThreadDefaults } = await import("./collect-only.js");
  // Trước 07/10 nhóm mới mặc định không đọc (DEFAULT_GROUP_READ=false) — loại 1 phải đọc hết (chốt 27/10/2026)
  assert.deepEqual(newThreadDefaults(true, { readMessages: false, captureFiles: false }), { readMessages: true, captureFiles: false });
  assert.deepEqual(newThreadDefaults(true, { readMessages: true, captureFiles: true }), { readMessages: true, captureFiles: true });
});

test("tài khoản Trợ lý giữ nguyên cài đặt đọc tin nhóm mới / tin riêng", async () => {
  const { newThreadDefaults } = await import("./collect-only.js");
  assert.deepEqual(newThreadDefaults(false, { readMessages: false, captureFiles: true }), { readMessages: false, captureFiles: true });
  assert.deepEqual(newThreadDefaults(false, { readMessages: true, captureFiles: false }), { readMessages: true, captureFiles: false });
});
