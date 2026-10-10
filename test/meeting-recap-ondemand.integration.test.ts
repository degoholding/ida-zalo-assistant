// Recap theo yêu cầu chat (phase 6, 10/10/2026) trên MySQL THẬT: đường tạo mới / requeue (Unmatched/Skipped/Failed →
// Queued, đích đổi theo cuộc đang hỏi), đường resend khi đã Done (trả PDF có sẵn, không gọi AI lần hai), đường báo
// đang xử lý (Processing). Drive / Calendar là bản giả (không gọi mạng thật).
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { MeetingRecordingStatus } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import type { DriveClient, DriveFileInfo } from "../src/google/drive-client.js";
import { runOndemandRecap } from "../src/meetings/meeting-recap-ondemand.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["meeting_recording"];
const NOW = new Date("2026-10-10T03:00:00Z");

function fakeDrive(files: DriveFileInfo[]): DriveClient {
  return {
    listNewFiles: async () => files,
    getFileMeta: async (id: string) => {
      const file = files.find((f) => f.id === id);
      if (!file) throw new Error("not found");
      return file;
    },
  } as unknown as DriveClient;
}

async function insertRow(db: Db, overrides: Record<string, unknown> = {}): Promise<number> {
  const row: Record<string, unknown> = {
    drive_file_id: "f1", file_name: "giao-ban.mp3", mime: "audio/mpeg", size_bytes: 1000,
    drive_created_at: NOW, status: MeetingRecordingStatus.Unmatched, note: "", ...overrides,
  };
  const columns = Object.keys(row);
  const [result] = await db.query<any>(
    `INSERT INTO meeting_recording (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    columns.map((column) => row[column]),
  );
  return result.insertId;
}

async function getRow(db: Db, id: number): Promise<RowDataPacket> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM meeting_recording WHERE id = ?", [id]);
  return rows[0];
}

describe("recap theo yêu cầu chat (phase 6)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
  });

  test("chưa có dòng nào cho tệp này → tạo mới Queued, đích = cuộc đang hỏi (nhóm)", async () => {
    const drive = fakeDrive([{ id: "f1", name: "giao-ban.mp3", mimeType: "audio/mpeg", size: 2000, createdTime: NOW.toISOString() }]);
    const outcome = await runOndemandRecap(db, { drive, calendar: null }, {}, { targetThreadId: 91, requesterUid: "uid-1" }, NOW);
    assert.match(String(outcome.response.reply), /đang nghe bản ghi/);
    const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM meeting_recording WHERE drive_file_id = 'f1'");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, MeetingRecordingStatus.Queued);
    assert.equal(rows[0].target_thread_id, 91);
    assert.equal(rows[0].requester_uid, "uid-1");
  });

  test("dòng cũ Unmatched (quét tự động không khớp được) → chat yêu cầu requeue về Queued, đích đổi theo cuộc đang hỏi, attempts về 0", async () => {
    const id = await insertRow(db, { status: MeetingRecordingStatus.Unmatched, target_thread_id: null, requester_uid: null, attempts: 2, note: "không khớp cuộc họp nào" });
    const drive = fakeDrive([{ id: "f1", name: "giao-ban.mp3", mimeType: "audio/mpeg", size: 2000, createdTime: NOW.toISOString() }]);
    const outcome = await runOndemandRecap(db, { drive, calendar: null }, { name: "giao ban" }, { targetThreadId: null, requesterUid: "uid-2" }, NOW);
    assert.equal(outcome.response.status, "queued");
    const row = await getRow(db, id);
    assert.equal(Number(row.status), MeetingRecordingStatus.Queued);
    assert.equal(row.target_thread_id, null);
    assert.equal(row.requester_uid, "uid-2");
    assert.equal(Number(row.attempts), 0);
    assert.equal(row.note, "");
  });

  test("dòng đang Processing → chỉ báo đang xử lý, KHÔNG đụng dòng", async () => {
    const id = await insertRow(db, { status: MeetingRecordingStatus.Processing, attempts: 1 });
    const drive = fakeDrive([{ id: "f1", name: "giao-ban.mp3", mimeType: "audio/mpeg", size: 2000, createdTime: NOW.toISOString() }]);
    const outcome = await runOndemandRecap(db, { drive, calendar: null }, {}, { targetThreadId: 91, requesterUid: "uid-1" }, NOW);
    assert.equal(outcome.response.status, "processing");
    const row = await getRow(db, id);
    assert.equal(Number(row.status), MeetingRecordingStatus.Processing);
    assert.equal(Number(row.attempts), 1); // không bị requeue / reset
  });

  test("dòng đã Done kèm PDF → trả lại đúng PDF cũ, KHÔNG gọi AI lần hai (không đổi trạng thái)", async () => {
    const files = [{ storageKey: "k/1", fileName: "recap.pdf", mimeType: "application/pdf" }];
    const id = await insertRow(db, { status: MeetingRecordingStatus.Done, meeting_title: "Giao ban K52", files: JSON.stringify(files) });
    const drive = fakeDrive([{ id: "f1", name: "giao-ban.mp3", mimeType: "audio/mpeg", size: 2000, createdTime: NOW.toISOString() }]);
    const outcome = await runOndemandRecap(db, { drive, calendar: null }, {}, { targetThreadId: 91, requesterUid: "uid-1" }, NOW);
    assert.equal(outcome.response.status, "done");
    assert.match(String(outcome.response.reply), /Giao ban K52/);
    assert.deepEqual(outcome.file, files[0]);
    const row = await getRow(db, id);
    assert.equal(Number(row.status), MeetingRecordingStatus.Done); // không đổi
  });

  test("không nói tên, thư mục trống → báo thư mục trống, không ghi dòng nào", async () => {
    const drive = fakeDrive([]);
    const outcome = await runOndemandRecap(db, { drive, calendar: null }, {}, { targetThreadId: 91, requesterUid: "uid-1" }, NOW);
    assert.match(String(outcome.response.error), /trống/);
    const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM meeting_recording");
    assert.equal(Number(rows[0].n), 0);
  });
});
