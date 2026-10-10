// Phase 8 — LỊCH gửi bản tin / báo cáo trên MySQL THẬT (việc nền `runBriefs` mỗi phút): giờ riêng từng người nhận, gửi
// bù trong ngày, chống trùng khi chạy lại / chạy song song, không gửi ngày nghỉ, báo cáo tuần 08:00 T2 / tháng ngày 3
// (dời sang ngày làm việc kế tiếp), giành lại dòng kẹt, job hết hạn hàng đợi. Đối chiếu doc/08-kich-ban-test-phase-8.md
// (mã N-xx / E-xx ghi ở tên bài). Zalo, AI là bản giả — chỉ kiểm brief_log + hàng đợi job (tiến trình app gửi đi).
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { runBriefs } from "../src/briefs/brief-runner.js";
import type { AppConfig } from "../src/config.js";
import { BriefKind, BriefStatus, BriefTrigger, JobStatus } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { LocalFileStorage } from "../src/storage/file-storage.js";
import {
  briefLogs, createPinnedPool, databaseUrl, makeCalendar, makeConfig, recipientJobs, resetTables, seedWorld, vn, type Phase8World,
} from "./phase8-brief-fixtures.js";

describe("phase 8 — lịch gửi bản tin / báo cáo", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let config: AppConfig;
  let world: Phase8World;
  let storageDir: string;
  let storage: LocalFileStorage;

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    storageDir = await mkdtemp(path.join(tmpdir(), "phase8-briefs-"));
    storage = new LocalFileStorage(storageDir);
  });
  after(async () => {
    await db?.end();
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetTables(db);
    config = makeConfig();
    world = await seedWorld(db);
  });

  /** Một lượt việc nền tại mốc `at` (giờ VN), đồng hồ MySQL ghim cùng mốc. */
  async function runAt(at: string, holidays = "") {
    const now = vn(at);
    const pinned = createPinnedPool(now);
    try {
      return await runBriefs(pinned, config, makeCalendar(holidays), storage, now);
    } finally {
      await pinned.end();
    }
  }

  const ofKind = async (kind: BriefKind) => (await briefLogs(db)).filter((row) => row.kind === kind);
  const recipientsOf = (rows: { recipient_id: number }[]) => rows.map((row) => row.recipient_id).sort((a, b) => a - b);

  test("N-01/N-03/N-04: each recipient gets the morning brief at their own time, once per day; empty time = never", async () => {
    assert.equal((await runAt("2026-10-13 07:29")).due, 0);
    await runAt("2026-10-13 07:30");
    let morning = await ofKind(BriefKind.Morning);
    assert.deepEqual(recipientsOf(morning), [world.mi]);
    assert.equal(morning[0].trigger_source, BriefTrigger.Schedule);
    assert.equal(morning[0].period_key, "2026-10-13");
    assert.equal(morning[0].status, BriefStatus.Queued);

    const jobs = await recipientJobs(db);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].payload.recipientId, world.mi);
    assert.equal(jobs[0].payload.briefLogId, morning[0].id);
    assert.match(jobs[0].payload.text, /^BẢN TIN SÁNG T3 13\/10 — Chị Mi\n1\. KHẨN\/quan trọng chưa xử lý: 0/);
    assert.match(jobs[0].payload.text, /Xem đủ: màn Bản tin trên web$/);

    // Mỗi phút sau vẫn «đến hạn» (khung bù) nhưng không soạn lại
    const again = await runAt("2026-10-13 07:31");
    assert.deepEqual([again.due, again.sent], [1, 0]);
    await runAt("2026-10-13 07:45");
    await runAt("2026-10-13 07:46");
    morning = await ofKind(BriefKind.Morning);
    assert.deepEqual(recipientsOf(morning), [world.mi, world.phong].sort((a, b) => a - b));
    assert.equal((await recipientJobs(db)).length, 2);
    // Chị Hằng (giờ trống) không có bản nào cả ngày, kể cả cuối ngày
    await runAt("2026-10-13 17:30");
    assert.equal((await briefLogs(db)).filter((row) => row.recipient_id === world.hang).length, 0);
    assert.deepEqual(recipientsOf(await ofKind(BriefKind.Evening)), [world.mi, world.phong].sort((a, b) => a - b));
  });

  test("E-06: two workers ticking the same minute still send one brief per recipient", async () => {
    await Promise.all([runAt("2026-10-13 07:30"), runAt("2026-10-13 07:30"), runAt("2026-10-13 07:30")]);
    assert.equal((await ofKind(BriefKind.Morning)).length, 1);
    assert.equal((await recipientJobs(db)).length, 1);
  });

  test("E-01/E-02: worker down past the morning time catches up until 12:00, then skips the day", async () => {
    await runAt("2026-10-13 11:59");
    assert.deepEqual(recipientsOf(await ofKind(BriefKind.Morning)), [world.mi, world.phong].sort((a, b) => a - b));
    await runAt("2026-10-14 12:01");
    assert.equal((await ofKind(BriefKind.Morning)).filter((row) => row.period_key === "2026-10-14").length, 0);
  });

  test("E-03/E-04: evening brief catches up until quiet hours start (21:00)", async () => {
    await runAt("2026-10-13 20:59");
    assert.deepEqual(recipientsOf(await ofKind(BriefKind.Evening)), [world.mi, world.phong].sort((a, b) => a - b));
    await runAt("2026-10-14 21:00");
    assert.equal((await ofKind(BriefKind.Evening)).filter((row) => row.period_key === "2026-10-14").length, 0);
  });

  test("N-59/E-07: nothing on Sunday or on a configured holiday", async () => {
    for (const at of ["2026-10-18 07:30", "2026-10-18 08:00", "2026-10-18 17:30"]) await runAt(at);
    for (const at of ["2026-10-14 07:45", "2026-10-14 17:30"]) await runAt(at, "14/10/2026");
    assert.deepEqual(await briefLogs(db), []);
  });

  test("E-18: an inactive recipient gets nothing", async () => {
    await db.query("UPDATE recipient SET is_active = 0 WHERE id = ?", [world.mi]);
    await runAt("2026-10-13 07:30");
    assert.deepEqual(await briefLogs(db), []);
  });

  test("N-05: weekly report at 08:00 Monday for every recipient (Hằng too), text then PDF then Excel in one job", async () => {
    await runAt("2026-10-12 07:59");
    assert.equal((await ofKind(BriefKind.Weekly)).length, 0);
    await runAt("2026-10-12 08:00");
    await runAt("2026-10-12 08:01");
    const weekly = await ofKind(BriefKind.Weekly);
    assert.deepEqual(recipientsOf(weekly), [world.mi, world.phong, world.hang].sort((a, b) => a - b));
    for (const row of weekly) {
      assert.equal(row.period_key, "2026-W41");
      assert.equal(row.period_label, "Tuần 41/2026 (05/10–11/10)");
      assert.equal(row.status, BriefStatus.Queued);
    }

    const job = (await recipientJobs(db)).find((item) => item.payload.recipientId === world.hang && item.payload.reportFiles)!;
    assert.match(job.payload.text, /^BÁO CÁO TUẦN Tuần 41\/2026 \(05\/10–11\/10\) — Chị Hằng\n/);
    assert.match(job.payload.text, /PDF \+ Excel gửi kèm$/);
    const files = job.payload.reportFiles as { fileName: string; storageKey: string }[];
    assert.deepEqual(files.map((file) => file.fileName), [
      "Bao-cao-tuan - Tuan-41-2026-05-10-11-10 - Chi-Hang.pdf",
      "Bao-cao-tuan - Tuan-41-2026-05-10-11-10 - Chi-Hang.xlsx",
    ]);
    const pdf = await readFile(path.join(storageDir, files[0].storageKey));
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    const xlsx = await readFile(path.join(storageDir, files[1].storageKey));
    assert.equal(xlsx.subarray(0, 2).toString(), "PK");
  });

  test("E-07: weekly report moves to Tuesday when Monday is a holiday", async () => {
    await runAt("2026-10-19 08:00", "19/10/2026");
    assert.deepEqual(await briefLogs(db), []);
    await runAt("2026-10-20 08:00", "19/10/2026");
    const weekly = await ofKind(BriefKind.Weekly);
    assert.equal(weekly.length, 3);
    assert.equal(weekly[0].period_label, "Tuần 42/2026 (12/10–18/10)");
  });

  test("E-12: turning off automatic periodic reports stops the weekly report but not the briefs", async () => {
    config.briefs.periodicReportsEnabled = false;
    await runAt("2026-10-12 08:00");
    assert.equal((await ofKind(BriefKind.Weekly)).length, 0);
    assert.equal((await ofKind(BriefKind.Morning)).length, 2);
  });

  test("N-62/N-64/E-08: monthly report on the 3rd at 08:00, never before; moved past a holiday", async () => {
    await runAt("2026-11-02 08:00");
    assert.equal((await ofKind(BriefKind.Monthly)).length, 0);
    await runAt("2026-11-03 08:00");
    const monthly = await ofKind(BriefKind.Monthly);
    assert.equal(monthly.length, 3);
    assert.deepEqual([monthly[0].period_key, monthly[0].period_label], ["2026-10", "Tháng 10/2026"]);
    const miJob = (await recipientJobs(db)).find((item) => item.payload.briefLogId === monthly.find((row) => row.recipient_id === world.mi)!.id)!;
    assert.equal(miJob.payload.reportFiles[0].fileName, "Bao-cao-thang - Thang-10-2026 - Chi-Mi.pdf");

    await resetTables(db);
    world = await seedWorld(db);
    await runAt("2026-11-03 08:00", "03/11/2026");
    assert.equal((await ofKind(BriefKind.Monthly)).length, 0);
    await runAt("2026-11-04 08:00", "03/11/2026");
    assert.equal((await ofKind(BriefKind.Monthly)).length, 3);
  });

  test("a brief stuck composing is redone on the same row after 15 minutes; a failed one is not retried", async () => {
    await db.query(
      `INSERT INTO brief_log (recipient_id, kind, trigger_source, period_key, status, dedupe_key, created_at) VALUES
       (?, ?, ?, '2026-10-13', ?, ?, ?), (?, ?, ?, '2026-10-13', ?, ?, ?)`,
      [world.mi, BriefKind.Morning, BriefTrigger.Schedule, BriefStatus.Composing, `r${world.mi}:1:2026-10-13`, vn("2026-10-13 07:30"),
        world.phong, BriefKind.Morning, BriefTrigger.Schedule, BriefStatus.Failed, `r${world.phong}:1:2026-10-13`, vn("2026-10-13 07:45")]);
    await runAt("2026-10-13 07:44");
    assert.equal((await briefLogs(db))[0].status, BriefStatus.Composing);
    assert.equal((await recipientJobs(db)).length, 0);

    await runAt("2026-10-13 07:46");
    const rows = await briefLogs(db);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, BriefStatus.Queued);
    assert.equal(rows[1].status, BriefStatus.Failed);
    assert.deepEqual((await recipientJobs(db)).map((job) => job.payload.briefLogId), [rows[0].id]);
  });

  test("two workers finding the same stuck row at the same minute: only one redoes it", async () => {
    await db.query(
      "INSERT INTO brief_log (recipient_id, kind, trigger_source, period_key, status, dedupe_key, created_at) VALUES (?, ?, ?, '2026-10-13', ?, ?, ?)",
      [world.mi, BriefKind.Morning, BriefTrigger.Schedule, BriefStatus.Composing, `r${world.mi}:1:2026-10-13`, vn("2026-10-13 07:30")]);
    await Promise.all([runAt("2026-10-13 07:46"), runAt("2026-10-13 07:46")]);
    assert.equal((await briefLogs(db)).filter((row) => row.recipient_id === world.mi).length, 1);
    assert.equal((await recipientJobs(db)).filter((job) => job.payload.recipientId === world.mi).length, 1);
  });

  test("E-16: a send job that expired in the queue marks the brief Failed and is not resent later", async () => {
    await runAt("2026-10-13 07:30");
    await db.query("UPDATE job SET status = ? WHERE kind = 3", [JobStatus.Expired]);
    // 09:40 vẫn trong khung bù sáng — chị Mi vẫn «đến hạn» nhưng không soạn / xếp lại
    await runAt("2026-10-13 09:40");
    const miRows = (await briefLogs(db)).filter((row) => row.recipient_id === world.mi);
    assert.equal(miRows.length, 1);
    assert.equal(miRows[0].status, BriefStatus.Failed);
    assert.equal(miRows[0].error, "Hết hạn hàng đợi gửi — chưa gửi được lần nào.");
    assert.equal((await recipientJobs(db)).filter((job) => job.payload.recipientId === world.mi).length, 1);
  });
});
