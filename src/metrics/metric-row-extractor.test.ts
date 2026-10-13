import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MetricFlag } from "../constants.js";
import { resolveColumns, validateMapping } from "./metric-mapping.js";
import { extractRecords, windowFromIso } from "./metric-row-extractor.js";
import { buildStaffIndex } from "./metric-staff-resolver.js";
import { MappingError } from "./metric-types.js";

const TODAY = "2026-10-12";
const SERIAL = (d: number) => 46307 + d; // 46307 = 12/10/2026
const mapping = (extra: object = {}) => (validateMapping({
  date: "Ngày", staff: "Nhân viên", area: "Khu vực",
  metrics: [{ code: "doanh_so", label: "Doanh số", column: "Doanh số", aggregate: "sum" }, { code: "ton_kho", column: "Tồn", aggregate: "last" }],
  ...extra,
}) as { mapping: never }).mapping;
const header = ["Ngày", "Nhân viên", "Khu vực", "Doanh số", "Tồn"];
const columns = (m = mapping()) => (resolveColumns(header, m) as { columns: never }).columns;
const staff = buildStaffIndex([{ id: 7, code: "NV07", name: "Lê Văn Tám", region: "Miền Tây", expectsReport: true }]);
const run = (rows: unknown[][], index = staff) => extractRecords([header, ...rows], columns(), "name", 1, index, TODAY);

describe("extractRecords", () => {
  test("maps a normal row, resolves staff and keeps window days", () => {
    const { records, warnings } = run([[SERIAL(0), "Lê Văn Tám", "Cần Thơ", "1.234.567", 80]]);
    assert.equal(warnings.length, 0);
    assert.equal(records.length, 2);
    const sales = records.find((r) => r.code === "doanh_so")!;
    assert.equal(sales.value, 1234567);
    assert.equal(sales.staffKey, "e:7");
    assert.equal(sales.areaKey, "can tho");
    assert.equal(sales.row, 2);
  });

  test("falls back to the catalog region when the area cell is empty", () => {
    const { records } = run([[SERIAL(0), "Lê Văn Tám", "", 5, 1]]);
    assert.equal(records[0].areaName, "Miền Tây");
  });

  test("sum rows add up, last rows keep the bottom one", () => {
    const { records } = run([[SERIAL(0), "Lê Văn Tám", "A", 100, 10], [SERIAL(0), "Lê Văn Tám", "A", 50, 7]]);
    assert.equal(records.find((r) => r.code === "doanh_so")!.value, 150);
    assert.equal(records.find((r) => r.code === "ton_kho")!.value, 7);
  });

  test("unparsed cell keeps raw text, sets flag, never becomes 0", () => {
    const { records, warnings } = run([[SERIAL(0), "Lê Văn Tám", "A", "#REF!", ""]]);
    assert.equal(records.length, 1);
    assert.equal(records[0].value, null);
    assert.equal(records[0].raw, "#REF!");
    assert.ok(records[0].baseFlags & MetricFlag.Unparsed);
    assert.match(warnings[0], /Dòng 2/);
  });

  test("unknown staff flagged only with a catalog", () => {
    assert.ok(run([[SERIAL(0), "Ai Đó", "A", 1, 1]]).records[0].baseFlags & MetricFlag.UnknownStaff);
    assert.equal(run([[SERIAL(0), "Ai Đó", "A", 1, 1]], buildStaffIndex([])).records[0].baseFlags, 0);
  });

  test("bad dates warn; far past / far future are dropped and counted", () => {
    const result = run([["hôm qua", "Lê Văn Tám", "A", 1, 1], [SERIAL(-70), "Lê Văn Tám", "A", 1, 1], [SERIAL(3), "Lê Văn Tám", "A", 1, 1], [SERIAL(1), "Lê Văn Tám", "A", 1, 1]]);
    assert.equal(result.warnings[0], "Dòng 2: ngày không đọc được");
    assert.equal(result.outOfWindow, 2);
    assert.equal(result.records.length, 2);
  });

  test("blank rows are skipped, missing staff warns", () => {
    const result = run([[], [SERIAL(0), "", "A", 1, 1]]);
    assert.equal(result.records.length, 0);
    assert.equal(result.warnings.length, 1);
  });

  test("caps warnings at 20 but counts all", () => {
    const rows = Array.from({ length: 30 }, () => ["x", "a", "b", 1, 1]);
    const result = run(rows);
    assert.equal(result.warnings.length, 20);
    assert.equal(result.warningTotal, 30);
  });

  test("too many rows is a MappingError", () => {
    const rows = Array.from({ length: 20_001 }, () => []);
    assert.throws(() => run(rows), MappingError);
  });

  test("window starts 61 days back", () => assert.equal(windowFromIso(TODAY), "2026-08-12"));
});
