import * as XLSX from "xlsx";

// Báo cáo trợ lý xuất ra file: một bảng (tiêu đề, vài dòng ghi chú, hàng tiêu đề cột, các dòng). Phần thuần:
// kiểm + chuẩn hóa tham số mô hình gửi lên (mô hình có thể gửi thiếu / thừa / sai kiểu), dựng tệp Excel,
// dựng ma trận ô để ghi Google Sheets. Hai đầu ra dùng chung một bố cục để người đọc thấy như nhau.

const MAX_COLUMNS = 20;
const MAX_ROWS = 1000;
const MAX_CELL_CHARS = 5000;
const MAX_TITLE_CHARS = 120;
const MAX_NOTES = 20;
/** Tên tab Excel tối đa 31 ký tự, không chứa : \ / ? * [ ] */
const EXCEL_SHEET_NAME_MAX = 31;
const EXCEL_FORBIDDEN = /[:\\/?*[\]]/g;

export interface ReportTable {
  title: string;
  notes: string[];
  columns: string[];
  rows: (string | number)[][];
}

export class ReportInputError extends Error {}

function toCell(value: unknown): string | number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return "";
  return String(value).slice(0, MAX_CELL_CHARS);
}

/** Tham số công cụ export_report → bảng đã kiểm. Sai thì ném ReportInputError (câu cho mô hình đọc mà sửa). */
export function normalizeReportTable(args: Record<string, unknown>): ReportTable {
  const title = typeof args.title === "string" ? args.title.trim().slice(0, MAX_TITLE_CHARS) : "";
  if (!title) throw new ReportInputError("Thiếu title (tiêu đề báo cáo)");
  const columns = Array.isArray(args.columns) ? args.columns.map((column) => String(column ?? "").trim()).slice(0, MAX_COLUMNS) : [];
  if (!columns.length || columns.every((column) => !column)) throw new ReportInputError("Thiếu columns (tên các cột)");
  const rawRows = Array.isArray(args.rows) ? args.rows : [];
  const rows = rawRows
    .filter((row): row is unknown[] => Array.isArray(row))
    .slice(0, MAX_ROWS)
    // Dòng thiếu ô thì bù rỗng, thừa ô thì cắt — giữ bảng vuông vức
    .map((row) => columns.map((_, index) => toCell(row[index])));
  if (!rows.length) throw new ReportInputError("Thiếu rows (các dòng của bảng, mỗi dòng là một mảng ô theo đúng thứ tự columns)");
  const notes = Array.isArray(args.notes)
    ? args.notes.map((note) => String(note ?? "").trim()).filter(Boolean).slice(0, MAX_NOTES).map((note) => note.slice(0, MAX_CELL_CHARS))
    : typeof args.notes === "string" && args.notes.trim() ? [args.notes.trim().slice(0, MAX_CELL_CHARS)] : [];
  return { title, notes, columns, rows };
}

/** Ma trận ô theo bố cục chung: tiêu đề · ghi chú · dòng trống · tiêu đề cột · dữ liệu. */
export function buildReportMatrix(table: ReportTable, createdAtText: string): (string | number)[][] {
  return [
    [table.title],
    [`Lập lúc ${createdAtText} bởi Bot trợ lý`],
    ...table.notes.map((note) => [note]),
    [],
    table.columns,
    ...table.rows,
  ];
}

export function excelSheetName(title: string): string {
  return title.replace(EXCEL_FORBIDDEN, " ").replace(/\s+/g, " ").trim().slice(0, EXCEL_SHEET_NAME_MAX) || "Báo cáo";
}

/** Tên tệp an toàn cho Zalo / đĩa: bỏ dấu, chỉ chữ số gạch, kèm ngày giờ để không trùng. */
export function reportFileName(title: string, stamp: string): string {
  const base = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "Bao-cao";
  return `${base}-${stamp}.xlsx`;
}

/** Tệp .xlsx một tab. Độ rộng cột theo chữ dài nhất (trần 60) cho mở ra đọc được ngay. */
export function buildReportWorkbook(table: ReportTable, createdAtText: string): Buffer {
  const matrix = buildReportMatrix(table, createdAtText);
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  const headerRowIndex = matrix.length - table.rows.length - 1;
  sheet["!cols"] = table.columns.map((column, index) => {
    const longest = Math.max(column.length, ...table.rows.map((row) => String(row[index] ?? "").length));
    return { wch: Math.min(60, Math.max(10, longest + 2)) };
  });
  // Lọc nhanh trên hàng tiêu đề cột
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRowIndex, c: 0 }, e: { r: matrix.length - 1, c: table.columns.length - 1 } }) };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, excelSheetName(table.title));
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
