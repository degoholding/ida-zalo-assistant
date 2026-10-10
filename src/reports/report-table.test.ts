import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { ReportInputError, buildReportMatrix, buildReportWorkbook, excelSheetName, normalizeReportTable, reportFileName } from "./report-table.js";

const VALID = {
  title: "Báo cáo tình hình các nhóm",
  notes: ["3 việc cần quyết ngay"],
  columns: ["Nhóm", "Tiến độ", "Vấn đề"],
  rows: [["K52", "Xong tầng 6", "Thiếu 2 thợ hàn"], ["Kế toán", "Đã chuyển lương", "Minh Phát nợ 420 triệu"]],
};

const rejects = (args: Record<string, unknown>, pattern: RegExp) =>
  assert.throws(() => normalizeReportTable(args), (error) => error instanceof ReportInputError && pattern.test(error.message));

test("rejects a report without title, columns or rows so the model can retry", () => {
  rejects({ ...VALID, title: "  " }, /title/);
  rejects({ ...VALID, title: 42 }, /title/);
  rejects({ ...VALID, columns: [] }, /columns/);
  rejects({ ...VALID, columns: ["", " "] }, /columns/);
  rejects({ ...VALID, columns: "Nhóm" }, /columns/);
  rejects({ ...VALID, rows: [] }, /rows/);
  rejects({ ...VALID, rows: ["không phải mảng", 5, null] }, /rows/);
});

test("pads short rows and trims long rows to the column count", () => {
  const table = normalizeReportTable({ ...VALID, rows: [["K52"], ["A", "B", "C", "D", "E"]] });
  assert.deepEqual(table.rows, [["K52", "", ""], ["A", "B", "C"]]);
});

test("keeps numbers, turns null and objects into text, caps cell size", () => {
  const table = normalizeReportTable({ ...VALID, rows: [[420000000, null, { a: 1 }], ["x".repeat(6000), undefined, true]] });
  assert.deepEqual(table.rows[0], [420000000, "", "[object Object]"]);
  assert.equal(String(table.rows[1][0]).length, 5000);
  assert.equal(table.rows[1][2], "true");
});

test("caps columns at 20 and rows at 1000", () => {
  const columns = Array.from({ length: 30 }, (_, index) => `C${index}`);
  const rows = Array.from({ length: 1500 }, () => ["v"]);
  const table = normalizeReportTable({ title: "T", columns, rows });
  assert.equal(table.columns.length, 20);
  assert.equal(table.rows.length, 1000);
});

test("accepts notes as a single string or an array, dropping blanks", () => {
  assert.deepEqual(normalizeReportTable({ ...VALID, notes: " một dòng " }).notes, ["một dòng"]);
  assert.deepEqual(normalizeReportTable({ ...VALID, notes: ["a", "", "  ", "b"] }).notes, ["a", "b"]);
  assert.deepEqual(normalizeReportTable({ ...VALID, notes: undefined }).notes, []);
});

test("lays out title, timestamp, notes, a blank line, header then rows", () => {
  const matrix = buildReportMatrix(normalizeReportTable(VALID), "05/10/2026 17:20");
  assert.deepEqual(matrix.slice(0, 5), [
    ["Báo cáo tình hình các nhóm"], ["Lập lúc 05/10/2026 17:20 bởi Bot trợ lý"], ["3 việc cần quyết ngay"], [], ["Nhóm", "Tiến độ", "Vấn đề"],
  ]);
  assert.equal(matrix.length, 7);
});

test("Excel sheet names drop forbidden characters and stay within 31 chars", () => {
  assert.equal(excelSheetName("Báo cáo: tuần 40 [K52] / K53?"), "Báo cáo tuần 40 K52 K53");
  assert.equal(excelSheetName("x".repeat(50)).length, 31);
  assert.equal(excelSheetName("::"), "Báo cáo");
});

test("file names follow the IDA convention «Tên công việc - Thời gian - Tên nhân viên», ASCII-safe", () => {
  assert.equal(reportFileName("Báo cáo công nợ Đà Nẵng", "Tuần 41/2026", "Trần Được", "07/10/2026"), "Bao-cao-cong-no-Da-Nang - Tuan-41-2026 - Tran-Duoc.xlsx");
  // Không có kỳ → ngày lập; không rõ người hỏi → Bot-tro-ly; tiêu đề toàn ký tự lạ → Bao-cao
  assert.equal(reportFileName("!!!", "", "", "07/10/2026"), "Bao-cao - 07-10-2026 - Bot-tro-ly.xlsx");
  assert.equal(reportFileName("Doanh số", "01.10–07.10.2026", "An", "07/10/2026"), "Doanh-so - 01.10-07.10.2026 - An.xlsx");
  // Đuôi tệp tùy chọn (phase 3: báo cáo tuần / tháng xuất cả PDF lẫn Excel cùng quy ước tên)
  assert.equal(reportFileName("Bao cao tuan", "Tuan 41-2026", "Tran Duoc", "07/10/2026", "pdf"), "Bao-cao-tuan - Tuan-41-2026 - Tran-Duoc.pdf");
});

test("extra sheets become their own tabs with unique names; a broken extra sheet is reported to the model", () => {
  const table = normalizeReportTable({ ...VALID, period: "Tuần 41/2026", extra_sheets: [
    { title: "Bất thường", columns: ["Việc", "Nguồn"], rows: [["Trễ hạn hợp đồng", "K52 · Mai · 03/10 09:00"]] },
    { title: "Báo cáo tình hình các nhóm", columns: ["A"], rows: [["x"]] },
  ] });
  const workbook = XLSX.read(buildReportWorkbook(table, "07/10/2026 14:00"), { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Báo cáo tình hình các nhóm", "Bất thường", "Báo cáo tình hình các nhóm (2)"]);
  const extra = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["Bất thường"], { header: 1, defval: "" });
  assert.deepEqual(extra[2], ["Việc", "Nguồn"]);
  assert.match(String(buildReportMatrix(table, "07/10/2026 14:00")[1][0]), /^Kỳ: Tuần 41\/2026 · Lập lúc/);
  assert.throws(() => normalizeReportTable({ ...VALID, extra_sheets: [{ title: "Rỗng", columns: ["A"], rows: [] }] }),
    (error) => error instanceof ReportInputError && /sheet phụ thứ 1/.test(error.message));
});

test("the workbook opens back with the same cells and a filter on the header row", () => {
  const buffer = buildReportWorkbook(normalizeReportTable(VALID), "05/10/2026 17:20");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  assert.equal(workbook.SheetNames[0], "Báo cáo tình hình các nhóm");
  assert.deepEqual(rows[4], ["Nhóm", "Tiến độ", "Vấn đề"]);
  assert.deepEqual(rows[6], ["Kế toán", "Đã chuyển lương", "Minh Phát nợ 420 triệu"]);
  assert.equal(sheet["!autofilter"]?.ref, "A5:C7");
});
