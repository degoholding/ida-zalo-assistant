import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { buildExportPdf, buildExportPdfDocument, buildExportWorkbook, cellText, classifyCell, type ExportTable } from "./export-table-file.js";

const table = (rows: Record<string, unknown>[], columns = [{ key: "day", label: "Ngày" }, { key: "at", label: "Lúc" }, { key: "n", label: "Số" }, { key: "name", label: "Tên" }]): ExportTable =>
  ({ title: "Báo cáo: thử/nghiệm*", lines: ["Kỳ: 2026-10-01 → 2026-10-07"], columns, rows });

test("ô ngày giờ VN → số sê-ri Excel đúng giờ VN (không lệch múi giờ máy chạy); ngày → sê-ri nửa đêm", () => {
  const datetime = classifyCell("2026-10-16T09:12:04+07:00");
  assert.equal(datetime.kind, "datetime");
  // 16/10/2026 = sê-ri 46311; 09:12:04 = 0.38338 ngày
  if (datetime.kind === "datetime") {
    assert.equal(Math.floor(datetime.serial), 46311);
    assert.ok(Math.abs((datetime.serial % 1) - (9 * 3600 + 12 * 60 + 4) / 86400) < 1e-9);
    assert.equal(datetime.text, "16/10/2026 09:12");
  }
  const day = classifyCell("2026-10-16");
  assert.deepEqual(day, { kind: "day", serial: 46311, text: "16/10/2026" });
});

test("giá trị lạ không thành ô ngày / số: giờ múi khác, chữ giống ngày, NaN, null, đối tượng, true/false", () => {
  assert.equal(classifyCell("2026-10-16T09:12:04Z").kind, "text", "chỉ giờ +07:00 của lõi mới là ô ngày");
  assert.equal(classifyCell("2026-10-16 ghi chú").kind, "text");
  assert.deepEqual(classifyCell(Number.NaN), { kind: "text", value: "" });
  assert.deepEqual(classifyCell(Number.POSITIVE_INFINITY), { kind: "text", value: "" });
  assert.deepEqual(classifyCell(null), { kind: "text", value: "" });
  assert.deepEqual(classifyCell(undefined), { kind: "text", value: "" });
  assert.deepEqual(classifyCell({ a: 1 }), { kind: "text", value: "{\"a\":1}" });
  assert.deepEqual([classifyCell(true), classifyCell(false)], [{ kind: "text", value: "Có" }, { kind: "text", value: "Không" }]);
  assert.equal(classifyCell(0).kind, "number");
  assert.equal(classifyCell(-5).kind, "number");
});

test("Excel: tiêu đề + dòng phụ + hàng cột; ô ngày / số có định dạng; tên tab bỏ ký tự cấm; ô chữ dài bị cắt", () => {
  const data = buildExportWorkbook(table([
    { day: "2026-10-16", at: "2026-10-16T09:12:04+07:00", n: 1234567, name: "x".repeat(6000) },
    { day: null, at: null, n: 2.5, name: "=HYPERLINK(\"http://x\")" },
  ]));
  const workbook = XLSX.read(data, { type: "buffer", cellNF: true });
  assert.equal(workbook.SheetNames[0], "Báo cáo  thử nghiệm".replace(/\s+/g, " "));
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: true });
  assert.deepEqual(rows[0], ["Báo cáo: thử/nghiệm*"]);
  assert.deepEqual(rows[3], ["Ngày", "Lúc", "Số", "Tên"]);
  assert.equal(sheet.A5.z, "dd/mm/yyyy");
  assert.equal(sheet.B5.z, "dd/mm/yyyy hh:mm");
  assert.equal(sheet.C5.z, "#,##0");
  assert.equal(sheet.C6.z, "#,##0.00");
  assert.ok(String(sheet.D5.v).length <= 5001);
  // Chuỗi bắt đầu bằng = vẫn là CHỮ, không thành công thức (chống chèn công thức từ tin Zalo)
  assert.equal(sheet.D6.t, "s");
  assert.equal(sheet.D6.f, undefined);
  assert.equal(sheet["!autofilter"]?.ref, "A4:D6");
});

test("Excel không dòng nào vẫn dựng được (chỉ hàng cột)", () => {
  const workbook = XLSX.read(buildExportWorkbook(table([])), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true });
  assert.deepEqual(rows.at(-1), ["Ngày", "Lúc", "Số", "Tên"]);
});

test("PDF: khổ ngang khi nhiều hơn 6 cột; cột toàn số căn phải; ngày hiện dd/mm/yyyy; dựng ra tệp %PDF thật", async () => {
  const wide = Array.from({ length: 8 }, (_, index) => ({ key: `c${index}`, label: `Cột ${index}` }));
  assert.equal((buildExportPdfDocument(table([], wide)) as { pageOrientation: string }).pageOrientation, "landscape");
  const narrow = buildExportPdfDocument(table([{ day: "2026-10-16", at: "2026-10-16T09:12:04+07:00", n: 1500, name: "A" }])) as any;
  assert.equal(narrow.pageOrientation, "portrait");
  const body = narrow.content.at(-1).table.body;
  assert.deepEqual(body[1].map((cell: any) => cell.text), ["16/10/2026", "16/10/2026 09:12", (1500).toLocaleString("vi-VN"), "A"]);
  assert.equal(body[1][2].alignment, "right");
  assert.equal(cellText("y".repeat(1000)).length, 401);
  const pdf = await buildExportPdf(table([{ day: "2026-10-16", at: null, n: 1, name: "Tiếng Việt có dấu" }]));
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
});
