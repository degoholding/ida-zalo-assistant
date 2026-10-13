// Phase 10 phase 4 — lõi số liệu N3 trên MySQL THẬT với bảng giả (không gọi Google): đọc lại không nhân dòng, sửa ô, xóa dòng,
// chống xóa nhầm (bảng trống), tab sai (MappingError giữ số cũ), lỗi Google, cờ, «chưa báo» tính khi xem, truy vấn tổng hợp.
//
// Chạy: TEST_DATABASE_URL=mysql://root:<mật khẩu>@127.0.0.1:3308/<csdl_thử> npm test

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RowDataPacket } from "mysql2";
import { CatalogKind, MetricFlag, MetricSourceStatus } from "../src/constants.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import type { GoogleSheetsClient } from "../src/google/sheets-client.js";
import { GoogleSheetsError, NOT_FOUND_TEXT } from "../src/google/sheets-error-messages.js";
import { listMissingReporters } from "../src/metrics/metric-missing-reporters.js";
import { aggregateMetrics, listMetricCatalog } from "../src/metrics/metric-query-service.js";
import { previewSource, syncSource, type MetricSyncDeps } from "../src/metrics/metric-sync-service.js";
import { databaseUrl, vn } from "./phase8-brief-fixtures.js";

const MAPPING = {
  date: "Ngày", staff: "Nhân viên", area: "Khu vực",
  metrics: [{ code: "doanh_so", label: "Doanh số", column: "Doanh số", unit: "đ", aggregate: "sum" }],
};
const HEADER = ["Ngày", "Nhân viên", "Khu vực", "Doanh số"];
const SERIAL_12_10 = 46307;

describe("phase 10 — lõi số liệu N3", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let sheet: unknown[][] = [];
  let failure: Error | null = null;
  let sourceId = 0;
  const deps = (): MetricSyncDeps => ({
    db,
    getClient: () => ({ getValues: async () => { if (failure) throw failure; return sheet; } }) as unknown as GoogleSheetsClient,
  });
  const T1 = vn("2026-10-12 09:00");

  const count = async () => {
    const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM metric_value WHERE source_id = ?", [sourceId]);
    return Number(rows[0].n);
  };
  const valueOf = async (staffKey: string, day: string) => {
    const [rows] = await db.query<RowDataPacket[]>(
      "SELECT value, flags, first_seen_at FROM metric_value WHERE source_id = ? AND staff_key = ? AND metric_date = ?", [sourceId, staffKey, day]);
    return rows[0];
  };
  const addStaff = async (code: string, name: string, expects = 1) => {
    const [result] = await db.query<{ insertId: number } & RowDataPacket[]>(
      "INSERT INTO catalog_entry (kind, code, name, region, expects_report) VALUES (?,?,?,?,?)", [CatalogKind.Staff, code, name, "Miền Tây", expects]);
    return result.insertId;
  };

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
  });
  after(async () => { await db?.end(); });

  beforeEach(async () => {
    await db.query("DELETE FROM metric_source");
    await db.query("DELETE FROM catalog_entry");
    failure = null;
    const [result] = await db.query<{ insertId: number } & RowDataPacket[]>(
      "INSERT INTO metric_source (name, spreadsheet_id, sheet_title, mapping, daily_report) VALUES ('BCSale', 'abc', 'NKCV', ?, 1)", [JSON.stringify(MAPPING)]);
    sourceId = result.insertId;
    sheet = [HEADER,
      [SERIAL_12_10, "Lê Văn Tám", "Cần Thơ", 100],
      [SERIAL_12_10, "Trần Thị Bảy", "Cần Thơ", 200],
      [SERIAL_12_10 - 1, "Lê Văn Tám", "Cần Thơ", 110],
      [SERIAL_12_10 - 1, "Trần Thị Bảy", "Cần Thơ", 190],
    ];
  });

  test("reading twice keeps the row count; editing a cell changes one row; deleting a row removes it", async () => {
    const first = await syncSource(deps(), sourceId, T1);
    assert.equal(first.status, MetricSourceStatus.Ok);
    assert.equal(await count(), 4);
    await syncSource(deps(), sourceId, vn("2026-10-12 09:30"));
    assert.equal(await count(), 4);

    sheet[1] = [SERIAL_12_10, "Lê Văn Tám", "Cần Thơ", 150];
    await syncSource(deps(), sourceId, vn("2026-10-12 10:00"));
    assert.equal(Number((await valueOf("n:le van tam", "2026-10-12")).value), 150);

    sheet.splice(4, 1);
    const result = await syncSource(deps(), sourceId, vn("2026-10-12 10:30"));
    assert.equal(result.removed, 1);
    assert.equal(await count(), 3);
  });

  test("an empty table does not wipe the old numbers", async () => {
    await syncSource(deps(), sourceId, T1);
    sheet = [HEADER];
    const result = await syncSource(deps(), sourceId, vn("2026-10-12 09:30"));
    assert.equal(result.status, MetricSourceStatus.Ok);
    assert.equal(await count(), 4);
    assert.match(result.warnings.at(-1) ?? "", /giữ nguyên số cũ/);
  });

  test("a table that really shrank by more than half: the background run keeps old numbers, admin «Đọc ngay» accepts it", async () => {
    await syncSource(deps(), sourceId, T1);
    sheet = [HEADER, [SERIAL_12_10, "Lê Văn Tám", "Cần Thơ", 100]];
    const background = await syncSource(deps(), sourceId, vn("2026-10-12 09:30"));
    assert.equal(background.removed, 0);
    assert.equal(await count(), 4);
    assert.match(background.warnings.at(-1) ?? "", /bấm «Đọc ngay» để chấp nhận/);
    const accepted = await syncSource(deps(), sourceId, vn("2026-10-12 09:40"), { acceptShrink: true });
    assert.equal(accepted.removed, 3);
    assert.equal(await count(), 1);
    // Bảng trống vẫn không bao giờ bị coi là «co lại thật», kể cả khi quản trị bấm «Đọc ngay»
    sheet = [HEADER];
    const empty = await syncSource(deps(), sourceId, vn("2026-10-12 09:50"), { acceptShrink: true });
    assert.equal(empty.removed, 0);
    assert.equal(await count(), 1);
  });

  test("a wrong tab is a MappingError and keeps old numbers", async () => {
    await syncSource(deps(), sourceId, T1);
    sheet = [["Cột lạ", "Khác"], ["x", "y"]];
    const result = await syncSource(deps(), sourceId, vn("2026-10-12 09:30"));
    assert.equal(result.status, MetricSourceStatus.MappingError);
    assert.match(result.error, /Không thấy cột/);
    assert.equal(await count(), 4);
    const [rows] = await db.query<RowDataPacket[]>("SELECT status, sync_started_at FROM metric_source WHERE id = ?", [sourceId]);
    assert.equal(rows[0].status, MetricSourceStatus.MappingError);
    assert.equal(rows[0].sync_started_at, null);
  });

  test("a Google error becomes a Failed status and never throws", async () => {
    failure = new GoogleSheetsError(NOT_FOUND_TEXT, 404);
    const result = await syncSource(deps(), sourceId, T1);
    assert.equal(result.status, MetricSourceStatus.Failed);
    assert.equal(result.error, NOT_FOUND_TEXT);
    failure = new Error("boom");
    assert.equal((await syncSource(deps(), sourceId, T1)).status, MetricSourceStatus.Failed);
  });

  test("a held lock skips the run", async () => {
    await db.query("UPDATE metric_source SET sync_started_at = ? WHERE id = ?", [T1, sourceId]);
    assert.equal((await syncSource(deps(), sourceId, new Date(T1.getTime() + 60_000))).skipped, true);
  });

  test("flags: deviation and unparsed", async () => {
    sheet = [HEADER, [SERIAL_12_10 - 1, "A", "X", 100], [SERIAL_12_10, "A", "X", 200], [SERIAL_12_10, "B", "X", "#REF!"]];
    await syncSource(deps(), sourceId, T1);
    assert.equal(Number((await valueOf("n:a", "2026-10-12")).flags) & MetricFlag.Deviation, MetricFlag.Deviation);
    assert.equal(Number((await valueOf("n:b", "2026-10-12")).flags) & MetricFlag.Unparsed, MetricFlag.Unparsed);
    assert.equal((await valueOf("n:b", "2026-10-12")).value, null);
  });

  test("missing / late reporters are computed at view time against 18:15", async () => {
    const tam = await addStaff("NV1", "Lê Văn Tám");
    const bay = await addStaff("NV2", "Trần Thị Bảy");
    await addStaff("NV3", "Phạm Văn Chín");
    await addStaff("NV4", "Nghỉ báo", 0);
    sheet = [HEADER, [SERIAL_12_10, "Lê Văn Tám", "", 100]];
    await syncSource(deps(), sourceId, vn("2026-10-12 17:00"));
    sheet = [HEADER, [SERIAL_12_10, "Lê Văn Tám", "", 100], [SERIAL_12_10, "Trần Thị Bảy", "", 50]];
    await syncSource(deps(), sourceId, vn("2026-10-12 18:30"));

    assert.equal((await listMissingReporters(db, "2026-10-12", vn("2026-10-12 17:59"))).ready, false);
    const view = await listMissingReporters(db, "2026-10-12", vn("2026-10-12 19:00"));
    assert.equal(view.ready, true);
    assert.deepEqual(view.missing.map((s) => s.name), ["Phạm Văn Chín"]);
    assert.deepEqual(view.late.map((s) => s.id), [bay]);
    assert.ok(tam);
  });

  test("the first successful run does not mark past days as late", async () => {
    await addStaff("NV1", "Lê Văn Tám");
    sheet = [HEADER, [SERIAL_12_10 - 1, "Lê Văn Tám", "", 100]];
    await syncSource(deps(), sourceId, vn("2026-10-12 09:00"));
    const view = await listMissingReporters(db, "2026-10-11", vn("2026-10-12 09:30"));
    assert.equal(view.late.length, 0);
    assert.equal(view.missing.length, 0);
  });

  test("a non-daily source never produces missing reporters", async () => {
    await db.query("UPDATE metric_source SET daily_report = 0 WHERE id = ?", [sourceId]);
    await addStaff("NV1", "Lê Văn Tám");
    assert.equal((await listMissingReporters(db, "2026-10-12", vn("2026-10-12 19:00"))).ready, false);
  });

  test("catalog and aggregation by staff with previous period", async () => {
    await syncSource(deps(), sourceId, T1);
    const catalog = await listMetricCatalog(db);
    assert.deepEqual(catalog.map((c) => c.code), ["doanh_so"]);
    const result = await aggregateMetrics(db, { codes: ["doanh_so"], from: "2026-10-12", to: "2026-10-12", groupBy: "staff" });
    assert.equal(result.total, 300);
    assert.equal(result.previousTotal, 300);
    const tam = result.rows.find((r) => r.label === "Lê Văn Tám")!;
    assert.deepEqual([tam.value, tam.previous], [100, 110]);
    const none = await aggregateMetrics(db, { codes: ["doanh_so"], from: "2026-10-12", to: "2026-10-12", areaKey: "khac", groupBy: "area" });
    assert.equal(none.rows.length, 0);
  });

  test("preview reads without writing", async () => {
    const result = await previewSource(deps(), { spreadsheetId: "abc", sheetTitle: "NKCV", headerRow: 1, mapping: MAPPING }, T1);
    assert.equal(result.ok, true);
    assert.equal(result.recordCount, 4);
    assert.equal(result.matched[0].column, "Doanh số");
    assert.equal(await count(), 0);
    const bad = await previewSource(deps(), { spreadsheetId: "abc", sheetTitle: "NKCV", headerRow: 1, mapping: { ...MAPPING, date: "Không có" } }, T1);
    assert.equal(bad.status, MetricSourceStatus.MappingError);
  });
});
