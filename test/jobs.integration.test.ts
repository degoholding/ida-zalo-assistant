// Kiểm hàng đợi việc (bảng job) trên MySQL THẬT: chống trùng, chạy lần lượt theo serial_key, hết hạn, thử lại,
// trả việc bỏ dở về hàng, và bộ chạy việc giữ đúng trần song song.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test
// Không có TEST_DATABASE_URL thì cả tệp bỏ qua.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { JobKind, JobStatus } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { claimJobs, completeJob, enqueueJob, failJob, purgeFinishedJobs, recoverOrphanedJobs, recoverStaleJobs, summarizeQueue } from "../src/jobs/job-queue.js";
import { JobRunner } from "../src/jobs/job-runner.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const DIRECT = JobKind.AssistantDirectReply;
const GROUP = JobKind.AssistantGroupReply;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function statusOf(db: Db, id: number): Promise<{ status: JobStatus; attempts: number; last_error: string }> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT status, attempts, last_error FROM job WHERE id = ?", [id]);
  return rows[0] as { status: JobStatus; attempts: number; last_error: string };
}

describe("hàng đợi việc", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;

  before(async () => {
    // Hai lần gọi song song như app + worker cùng khởi động: khóa tên giữ cho không tệp nào chạy hai lần
    await Promise.all([runMigrations(databaseUrl!), runMigrations(databaseUrl!)]);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => { await db.query("DELETE FROM job"); });

  test("the same dedupe key is stored once — a second bot in the group cannot queue the same message again", async () => {
    const first = await enqueueJob(db, { kind: GROUP, payload: { n: 1 }, dedupeKey: "grp:g1:m1" });
    const second = await enqueueJob(db, { kind: GROUP, payload: { n: 2 }, dedupeKey: "grp:g1:m1" });
    assert.ok(first);
    assert.equal(second, null);
    // Đã xong rồi cũng vẫn chặn — Zalo gửi lại tin cũ lúc nối lại không làm bot trả lời lần hai
    await completeJob(db, first);
    assert.equal(await enqueueJob(db, { kind: GROUP, payload: {}, dedupeKey: "grp:g1:m1" }), null);
  });

  test("two questions in the same conversation never run at the same time, a different conversation is not blocked", async () => {
    const a1 = await enqueueJob(db, { kind: DIRECT, payload: {}, serialKey: "thread:1" });
    const a2 = await enqueueJob(db, { kind: DIRECT, payload: {}, serialKey: "thread:1" });
    const b1 = await enqueueJob(db, { kind: DIRECT, payload: {}, serialKey: "thread:2" });
    const firstClaim = await claimJobs(db, "t", [DIRECT], 10);
    assert.deepEqual(firstClaim.map((job) => job.id).sort(), [a1, b1].sort());
    // a1 còn đang chạy → a2 không được lấy dù còn chỗ
    assert.deepEqual(await claimJobs(db, "t", [DIRECT], 10), []);
    await completeJob(db, a1!);
    assert.deepEqual((await claimJobs(db, "t", [DIRECT], 10)).map((job) => job.id), [a2]);
  });

  test("on start-up a role takes back its own half-done jobs at once, so later questions in that chat are not blocked", async () => {
    // Lỗi 08/10/2026: khởi động lại lúc deploy giữa một câu trả lời nhóm → việc kẹt «đang chạy», cả nhóm đứng tới 30 phút
    await enqueueJob(db, { kind: JobKind.AssistantGroupReply, payload: { n: 1 }, serialKey: "group:9", maxAttempts: 2 });
    await enqueueJob(db, { kind: JobKind.AssistantGroupReply, payload: { n: 2 }, serialKey: "group:9" });
    await enqueueJob(db, { kind: JobKind.RecipientMessage, payload: { n: 3 } });
    const [first] = await claimJobs(db, "app:old-host:1", [JobKind.AssistantGroupReply], 5);
    await claimJobs(db, "worker:x:1", [JobKind.RecipientMessage], 5);
    // Câu sau cùng nhóm bị chặn khi câu trước còn «đang chạy»
    assert.equal((await claimJobs(db, "app:new:1", [JobKind.AssistantGroupReply], 5)).length, 0);
    assert.equal(await recoverOrphanedJobs(db, "app", [JobKind.AssistantGroupReply]), 1);
    // Việc của vai trò khác (worker) không đụng
    const [rows] = await db.query<RowDataPacket[]>("SELECT id, status, attempts FROM job ORDER BY id");
    assert.deepEqual(rows.map((row) => Number(row.status)), [JobStatus.Pending, JobStatus.Pending, JobStatus.Running]);
    const again = await claimJobs(db, "app:new:1", [JobKind.AssistantGroupReply], 5);
    assert.deepEqual(again.map((job) => job.id), [first.id]);
    // Hết lượt thử (2/2) mà lại bỏ dở → Failed, câu sau được chạy
    assert.equal(await recoverOrphanedJobs(db, "app", [JobKind.AssistantGroupReply]), 1);
    const [after2] = await db.query<RowDataPacket[]>("SELECT status FROM job WHERE id = ?", [first.id]);
    assert.equal(Number(after2[0].status), JobStatus.Failed);
    assert.equal((await claimJobs(db, "app:new:1", [JobKind.AssistantGroupReply], 5)).length, 1);
  });

  test("a claim only takes the kinds asked for and only jobs that are due", async () => {
    await enqueueJob(db, { kind: GROUP, payload: {} });
    const later = await enqueueJob(db, { kind: DIRECT, payload: {}, runAfter: new Date(Date.now() + 60_000) });
    assert.deepEqual(await claimJobs(db, "t", [DIRECT], 10), []);
    assert.equal((await claimJobs(db, "t", [GROUP], 10)).length, 1);
    assert.equal((await statusOf(db, later!)).status, JobStatus.Pending);
  });

  test("a job past its expiry is dropped instead of being answered late", async () => {
    const id = await enqueueJob(db, { kind: DIRECT, payload: {}, runAfter: new Date(Date.now() - 120_000), expiresInMs: 60_000 });
    assert.deepEqual(await claimJobs(db, "t", [DIRECT], 10), []);
    assert.equal((await statusOf(db, id!)).status, JobStatus.Expired);
  });

  test("a failing job goes back to the queue with a delay until it runs out of attempts", async () => {
    const id = await enqueueJob(db, { kind: DIRECT, payload: {}, maxAttempts: 2 });
    const [first] = await claimJobs(db, "t", [DIRECT], 1);
    assert.equal(first.attempts, 1);
    assert.equal(await failJob(db, first, "lỗi lần 1"), JobStatus.Pending);
    // Đang trong khoảng giãn — chưa lấy lại được
    assert.deepEqual(await claimJobs(db, "t", [DIRECT], 1), []);
    await db.query("UPDATE job SET run_after = NOW(3) WHERE id = ?", [id]);
    const [second] = await claimJobs(db, "t", [DIRECT], 1);
    assert.equal(second.attempts, 2);
    assert.equal(await failJob(db, second, "x".repeat(2000)), JobStatus.Failed);
    const row = await statusOf(db, id!);
    assert.equal(row.status, JobStatus.Failed);
    // Câu lỗi dài bị cắt cho vừa cột, không làm hỏng lệnh ghi
    assert.equal(row.last_error.length, 1000);
  });

  test("a job left running by a dead process is put back, or failed when it has no attempts left", async () => {
    const retry = await enqueueJob(db, { kind: DIRECT, payload: {}, maxAttempts: 3 });
    const spent = await enqueueJob(db, { kind: GROUP, payload: {}, maxAttempts: 1 });
    await claimJobs(db, "chết", [DIRECT, GROUP], 10);
    await db.query("UPDATE job SET locked_at = NOW(3) - INTERVAL 1 HOUR");
    assert.equal(await recoverStaleJobs(db, 30 * 60_000), 2);
    assert.equal((await statusOf(db, retry!)).status, JobStatus.Pending);
    assert.equal((await statusOf(db, spent!)).status, JobStatus.Failed);
    // Việc đang chạy bình thường (mới nhận) không bị đụng
    const fresh = await enqueueJob(db, { kind: DIRECT, payload: {} });
    await db.query("UPDATE job SET status = ? WHERE id <> ?", [JobStatus.Done, fresh]);
    await claimJobs(db, "sống", [DIRECT], 1);
    assert.equal(await recoverStaleJobs(db, 30 * 60_000), 0);
  });

  test("two processes claiming at the same moment never get the same job", async () => {
    for (let n = 0; n < 20; n += 1) await enqueueJob(db, { kind: DIRECT, payload: { n } });
    const [left, right] = await Promise.all([claimJobs(db, "a", [DIRECT], 15), claimJobs(db, "b", [DIRECT], 15)]);
    const ids = [...left, ...right].map((job) => job.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 20);
  });

  test("old finished jobs are purged, pending ones are kept, and the summary counts what is left", async () => {
    const done = await enqueueJob(db, { kind: DIRECT, payload: {} });
    await completeJob(db, done!);
    await db.query("UPDATE job SET finished_at = NOW(3) - INTERVAL 30 DAY WHERE id = ?", [done]);
    await enqueueJob(db, { kind: DIRECT, payload: {} });
    assert.equal(await purgeFinishedJobs(db, 14), 1);
    const summary = await summarizeQueue(db);
    assert.equal(summary.pending, 1);
    assert.equal(summary.running, 0);
  });

  test("the runner never runs more jobs at once than its limit, runs a conversation in order, and records results", async () => {
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const runner = new JobRunner({
      db, role: "test", concurrency: 3, pollMs: 50,
      handlers: {
        [DIRECT]: async (job) => {
          active += 1;
          peak = Math.max(peak, active);
          await wait(40);
          order.push((job.payload as { n: number }).n);
          active -= 1;
        },
        [GROUP]: async () => { throw new Error("hỏng có chủ ý"); },
      },
    });
    for (let n = 0; n < 8; n += 1) await enqueueJob(db, { kind: DIRECT, payload: { n } });
    // Ba câu cùng một cuộc phải ra đúng thứ tự gửi
    for (const n of [100, 101, 102]) await enqueueJob(db, { kind: DIRECT, payload: { n }, serialKey: "thread:9" });
    const broken = await enqueueJob(db, { kind: GROUP, payload: {}, maxAttempts: 1 });
    await runner.start();
    for (let tick = 0; tick < 100; tick += 1) {
      const summary = await summarizeQueue(db);
      if (!summary.pending && !summary.running) break;
      await wait(50);
    }
    await runner.stop();
    assert.ok(peak <= 3, `chạy song song ${peak} việc, trần là 3`);
    assert.equal(order.length, 11);
    assert.deepEqual(order.filter((n) => n >= 100), [100, 101, 102]);
    const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM job WHERE status = ?", [JobStatus.Done]);
    assert.equal(Number(rows[0].n), 11);
    const failed = await statusOf(db, broken!);
    assert.equal(failed.status, JobStatus.Failed);
    assert.match(failed.last_error, /hỏng có chủ ý/);
  });
});
