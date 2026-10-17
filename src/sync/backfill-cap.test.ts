import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeDb } from "../data-access/data-access-test-support.js";
import { SyncService } from "../sync-service.js";
import { BackfillBusyError, MAX_CONCURRENT_BACKFILLS_PER_ACCOUNT } from "./backfill-busy-error.js";

// «Lấy tin cũ»: trần số nhóm chạy cùng lúc trên một tài khoản bot + giữ chỗ trước await (không chạy đôi khi bấm sát nhau).
// Dựng SyncService không qua constructor (cần cấu hình đầy đủ) — chỉ gắn các trường startBackfill đọc.

function serviceWith(pending: Promise<unknown>) {
  const { db } = fakeDb((_sql, params) => [{ zalo_group_id: `zg-${params[0]}`, bot_account_id: 1 }]);
  const service = Object.create(SyncService.prototype) as any;
  service.db = db;
  service.backfillJobs = new Map();
  service.backfillAccounts = new Map();
  const started: string[] = [];
  service.runners = new Map([[1, { backfillGroup: (zaloGroupId: string) => { started.push(zaloGroupId); return pending; } }]]);
  return { service: service as SyncService, started };
}

test("the third concurrent backfill on one account is refused with BackfillBusyError, and its slot is released", async () => {
  const { service, started } = serviceWith(new Promise(() => undefined));
  for (let group = 1; group <= MAX_CONCURRENT_BACKFILLS_PER_ACCOUNT; group++) await service.startBackfill(group, { full: false });
  await assert.rejects(service.startBackfill(99, { full: false }), (error: unknown) =>
    error instanceof BackfillBusyError && /Đang lấy tin cũ cho 2 nhóm, thử lại sau/.test(error.message));
  assert.equal(service.getBackfillJob(99), null, "chỗ giữ trước phải được trả lại khi bị từ chối");
  assert.equal(started.length, MAX_CONCURRENT_BACKFILLS_PER_ACCOUNT);
});

test("a finished job frees its slot", async () => {
  const { service } = serviceWith(Promise.resolve({}));
  await service.startBackfill(1, { full: false });
  await service.startBackfill(2, { full: false });
  await new Promise((resolve) => setImmediate(resolve));
  await service.startBackfill(3, { full: false });
});

test("two simultaneous requests for the SAME group start only one job (reserved before the first await)", async () => {
  const { service, started } = serviceWith(new Promise(() => undefined));
  const [first, second] = await Promise.all([service.startBackfill(5, { full: true }), service.startBackfill(5, { full: true })]);
  assert.equal(first, second);
  assert.equal(started.length, 1);
});
