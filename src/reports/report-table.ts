import * as XLSX from "xlsx";

// Báo cáo trợ lý xuất ra file: bảng CHÍNH (tiêu đề, kỳ báo cáo, tóm tắt đầu trang, bảng chi tiết) + tối đa vài
// sheet PHỤ (vd «Bất thường», «Theo nhân viên» — 07/10/2026). Phần thuần:
// kiểm + chuẩn hóa tham số mô hình gửi lên (mô hình có thể gửi thiếu / thừa / sai kiểu), dựng tệp Excel,
// dựng ma trận ô để ghi Google Sheets. Hai đầu ra dùng chung một bố cục để người đọc thấy như nhau.

const MAX_COLUMNS = 20;
const MAX_ROWS = 1000;
const MAX_CELL_CHARS = 5000;
const MAX_TITLE_CHARS = 120;
const MAX_NOTES = 20;
const MAX_EXTRA_SHEETS = 4;
/** Tên tab Excel tối đa 31 ký tự, không chứa : \ / ? * [ ] */
const EXCEL_SHEET_NAME_MAX = 31;
const EXCEL_FORBIDDEN = /[:\\/?*[\]]/g;

export interface ReportSheet {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface ReportTable extends ReportSheet {
  /** Kỳ báo cáo («Tuần 41/2026», «01/10–07/10/2026») — ghi đầu trang và vào tên tệp. */
  period: string;
  /** Tóm tắt đầu trang (vài ý có số). */
  notes: string[];
  /** Sheet phụ — tab riêng trong Excel / Google Sheets. */
  extraSheets: ReportSheet[];
}

export class ReportInputError extends Error {}

function toCell(value: unknown): string | number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return "";
  return String(value).slice(0, MAX_CELL_CHARS);
}

/** Một bảng (tiêu đề + cột + dòng) đã kiểm; `where` cho câu báo lỗi biết bảng nào sai. */
function normalizeSheet(source: Record<string, unknown>, where: string): ReportSheet {
  const title = typeof source.title === "string" ? source.title.trim().slice(0, MAX_TITLE_CHARS) : "";
  if (!title) throw new ReportInputError(`Thiếu title (tiêu đề ${where})`);
  const columns = Array.isArray(source.columns) ? source.columns.map((column) => String(column ?? "").trim()).slice(0, MAX_COLUMNS) : [];
  if (!columns.length || columns.every((column) => !column)) throw new ReportInputError(`Thiếu columns (tên các cột của ${where})`);
  const rawRows = Array.isArray(source.rows) ? source.rows : [];
  const rows = rawRows
    .filter((row): row is unknown[] => Array.isArray(row))
    .slice(0, MAX_ROWS)
    // Dòng thiếu ô thì bù rỗng, thừa ô thì cắt — giữ bảng vuông vức
    .map((row) => columns.map((_, index) => toCell(row[index])));
  if (!rows.length) throw new ReportInputError(`Thiếu rows (các dòng của ${where}, mỗi dòng là một mảng ô theo đúng thứ tự columns)`);
  return { title, columns, rows };
}

/** Tham số công cụ export_report → bảng đã kiểm. Sai thì ném ReportInputError (câu cho mô hình đọc mà sửa). */
export function normalizeReportTable(args: Record<string, unknown>): ReportTable {
  const { title, columns, rows } = normalizeSheet(args, "báo cáo");
  const period = typeof args.period === "string" ? args.period.trim().slice(0, 60) : "";
  const extraSheets = (Array.isArray(args.extra_sheets) ? args.extra_sheets : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .slice(0, MAX_EXTRA_SHEETS)
    .map((item, index) => normalizeSheet(item, `sheet phụ thứ ${index + 1}`));
  const notes = Array.isArray(args.notes)
    ? args.notes.map((note) => String(note ?? "").trim()).filter(Boolean).slice(0, MAX_NOTES).map((note) => note.slice(0, MAX_CELL_CHARS))
    : typeof args.notes === "string" && args.notes.trim() ? [args.notes.trim().slice(0, MAX_CELL_CHARS)] : [];
  return { title, period, notes, columns, rows, extraSheets };
}

/** Ma trận ô theo bố cục chung: tiêu đề · kỳ + lập lúc · tóm tắt · dòng trống · tiêu đề cột · dữ liệu. */
export function buildReportMatrix(table: ReportTable, createdAtText: string): (string | number)[][] {
  return [
    [table.title],
    [`${table.period ? `Kỳ: ${table.period} · ` : ""}Lập lúc ${createdAtText} bởi Bot trợ lý`],
    ...table.notes.map((note) => [note]),
    [],
    table.columns,
    ...table.rows,
  ];
}

/** Sheet phụ: tiêu đề · dòng trống · tiêu đề cột · dữ liệu. */
export function buildSheetMatrix(sheet: ReportSheet): (string | number)[][] {
  return [[sheet.title], [], sheet.columns, ...sheet.rows];
}

export function excelSheetName(title: string): string {
  return title.replace(EXCEL_FORBIDDEN, " ").replace(/\s+/g, " ").trim().slice(0, EXCEL_SHEET_NAME_MAX) || "Báo cáo";
}

const asciiSlug = (text: string, max: number) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
  .replace(/[^A-Za-z0-9.]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, max).replace(/[-.]+$/, "");

/**
 * Tên tệp theo quy ước IDA «Tên công việc - Thời gian - Tên nhân viên» (đặc tả N6), bỏ dấu cho Zalo / đĩa, vd
 * «Bao-cao-cong-no - Tuan-41-2026 - Tran-Duoc.xlsx». Không có kỳ thì lấy ngày lập; không rõ người hỏi thì «Bot-tro-ly».
 * `extension` (phase 3, báo cáo tuần / tháng có cả PDF lẫn Excel) mặc định «xlsx» — nơi gọi cũ không phải đổi.
 */
export function reportFileName(title: string, period: string, requester: string, dateText: string, extension = "xlsx"): string {
  const parts = [asciiSlug(title, 60) || "Bao-cao", asciiSlug(period, 30) || asciiSlug(dateText, 30), asciiSlug(requester, 30) || "Bot-tro-ly"];
  return `${parts.join(" - ")}.${extension}`;
}

/** Một tab Excel: độ rộng cột theo chữ dài nhất (trần 60), lọc nhanh trên hàng tiêu đề cột. */
function buildSheet(matrix: (string | number)[][], columns: string[], rows: (string | number)[][]): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  const headerRowIndex = matrix.length - rows.length - 1;
  sheet["!cols"] = columns.map((column, index) => {
    const longest = Math.max(column.length, ...rows.map((row) => String(row[index] ?? "").length));
    return { wch: Math.min(60, Math.max(10, longest + 2)) };
  });
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRowIndex, c: 0 }, e: { r: matrix.length - 1, c: columns.length - 1 } }) };
  return sheet;
}

/** Tệp .xlsx: tab chính (tóm tắt + chi tiết) rồi các tab phụ; tên tab không trùng nhau. */
export function buildReportWorkbook(table: ReportTable, createdAtText: string): Buffer {
  const workbook = XLSX.utils.book_new();
  const used = new Set<string>();
  const uniqueName = (title: string) => {
    const base = excelSheetName(title);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base.slice(0, EXCEL_SHEET_NAME_MAX - 4)} (${n})`;
    used.add(name.toLowerCase());
    return name;
  };
  XLSX.utils.book_append_sheet(workbook, buildSheet(buildReportMatrix(table, createdAtText), table.columns, table.rows), uniqueName(table.title));
  for (const extra of table.extraSheets) {
    XLSX.utils.book_append_sheet(workbook, buildSheet(buildSheetMatrix(extra), extra.columns, extra.rows), uniqueName(extra.title));
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
