import * as XLSX from "xlsx";
import { COLOR, MAIN_FONT, getEngine } from "./pdf-engine.js";

// Dựng tệp từ MỘT bảng dữ liệu (công cụ MCP export_report, phase 13.4): Excel có định dạng ngày / số thật (ô ngày là số sê-ri Excel theo giờ
// VN, ô số có dấu phân nghìn, lọc nhanh trên hàng tiêu đề cột) hoặc PDF bảng đơn giản (pdfmake + font sẵn có, khổ ngang khi nhiều cột).
// Hàm thuần trên dữ liệu đã kiểm quyền + đã che — không đọc DB, không tự che.

export interface ExportColumn {
  key: string;
  label: string;
}

export interface ExportTable {
  title: string;
  /** Các dòng dưới tiêu đề: kỳ, lúc lập, ghi chú cắt dòng… */
  lines: string[];
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
}

const EXCEL_CELL_MAX = 5000;
const PDF_CELL_MAX = 400;
const EXCEL_EPOCH_DAYS = 25569;
const DAY_MS = 86_400_000;
const DATETIME_VN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\+07:00$/;
const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_FORMAT = "dd/mm/yyyy hh:mm";
const DAY_FORMAT = "dd/mm/yyyy";

type CellValue = { kind: "datetime"; serial: number; text: string } | { kind: "day"; serial: number; text: string }
  | { kind: "number"; value: number } | { kind: "text"; value: string };

/** Một giá trị JSON → ô có kiểu. Giờ ISO +07:00 (vỏ kết quả của lõi) và ngày 'YYYY-MM-DD' thành ô ngày. Hàm thuần. */
export function classifyCell(value: unknown): CellValue {
  if (value === null || value === undefined) return { kind: "text", value: "" };
  if (typeof value === "number") return Number.isFinite(value) ? { kind: "number", value } : { kind: "text", value: "" };
  if (typeof value === "boolean") return { kind: "text", value: value ? "Có" : "Không" };
  if (typeof value !== "string") return { kind: "text", value: JSON.stringify(value) };
  const datetime = DATETIME_VN.exec(value);
  if (datetime) {
    const [, y, m, d, h, mi, s] = datetime.map(Number);
    const serial = Date.UTC(y, m - 1, d, h, mi, s) / DAY_MS + EXCEL_EPOCH_DAYS;
    return { kind: "datetime", serial, text: `${datetime[3]}/${datetime[2]}/${datetime[1]} ${datetime[4]}:${datetime[5]}` };
  }
  const day = DAY_ONLY.exec(value);
  if (day) {
    const serial = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])) / DAY_MS + EXCEL_EPOCH_DAYS;
    if (Number.isFinite(serial)) return { kind: "day", serial, text: `${day[3]}/${day[2]}/${day[1]}` };
  }
  return { kind: "text", value };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Tệp .xlsx một tab: tiêu đề · các dòng phụ · dòng trống · tiêu đề cột · dữ liệu. */
export function buildExportWorkbook(table: ExportTable): Buffer {
  const headerRow = 1 + table.lines.length + 1;
  const matrix: (string | number)[][] = [[table.title], ...table.lines.map((line) => [line]), [], table.columns.map((column) => column.label)];
  const formats: { r: number; c: number; z: string }[] = [];
  const widths = table.columns.map((column) => column.label.length);
  table.rows.forEach((row, rowIndex) => {
    matrix.push(table.columns.map((column, columnIndex) => {
      const cell = classifyCell(row[column.key]);
      const r = headerRow + 1 + rowIndex;
      if (cell.kind === "datetime" || cell.kind === "day") {
        formats.push({ r, c: columnIndex, z: cell.kind === "datetime" ? DATETIME_FORMAT : DAY_FORMAT });
        widths[columnIndex] = Math.max(widths[columnIndex], cell.kind === "datetime" ? 16 : 10);
        return cell.serial;
      }
      if (cell.kind === "number") {
        formats.push({ r, c: columnIndex, z: Number.isInteger(cell.value) ? "#,##0" : "#,##0.00" });
        widths[columnIndex] = Math.max(widths[columnIndex], String(cell.value).length + 2);
        return cell.value;
      }
      const text = clip(cell.value, EXCEL_CELL_MAX);
      widths[columnIndex] = Math.max(widths[columnIndex], Math.min(text.length, 60));
      return text;
    }));
  });
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  for (const format of formats) {
    const cell = sheet[XLSX.utils.encode_cell({ r: format.r, c: format.c })] as XLSX.CellObject | undefined;
    if (cell) cell.z = format.z;
  }
  sheet["!cols"] = widths.map((width) => ({ wch: Math.min(60, Math.max(10, width + 2)) }));
  if (table.columns.length) {
    sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: headerRow + table.rows.length, c: table.columns.length - 1 } }) };
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName(table.title));
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function sheetName(title: string): string {
  return title.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Bao cao";
}

/** Chữ hiển thị của một ô cho PDF. */
export function cellText(value: unknown): string {
  const cell = classifyCell(value);
  if (cell.kind === "datetime" || cell.kind === "day") return cell.text;
  if (cell.kind === "number") return cell.value.toLocaleString("vi-VN");
  return clip(cell.value, PDF_CELL_MAX);
}

/** Định nghĩa tài liệu pdfmake (tách để test không cần dựng PDF). */
export function buildExportPdfDocument(table: ExportTable): object {
  const landscape = table.columns.length > 6;
  const numeric = table.columns.map((column) => table.rows.some((row) => typeof row[column.key] === "number")
    && table.rows.every((row) => row[column.key] === null || row[column.key] === undefined || typeof row[column.key] === "number"));
  const body = [
    table.columns.map((column) => ({ text: column.label, color: "white", bold: true })),
    ...table.rows.map((row) => table.columns.map((column, index) => ({ text: cellText(row[column.key]), alignment: numeric[index] ? "right" : "left" }))),
  ];
  return {
    pageSize: "A4", pageOrientation: landscape ? "landscape" : "portrait", pageMargins: [28, 32, 28, 40],
    defaultStyle: { font: MAIN_FONT, fontSize: table.columns.length > 8 ? 6.5 : 8, color: COLOR.text },
    info: { title: table.title, author: "Bot trợ lý — DEGO HOLDING" },
    footer: (currentPage: number, pageCount: number) => ({
      text: `${table.title} · Tài liệu nội bộ · ${currentPage}/${pageCount}`, fontSize: 7, color: COLOR.muted, alignment: "center", margin: [28, 12, 28, 0],
    }),
    content: [
      { text: table.title, fontSize: 14, bold: true, color: COLOR.tealText, margin: [0, 0, 0, 4] },
      ...table.lines.map((line) => ({ text: line, fontSize: 8, color: COLOR.muted })),
      {
        table: { headerRows: 1, widths: table.columns.map(() => "*"), body },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? COLOR.teal : rowIndex % 2 === 0 ? COLOR.tealLight : null),
          hLineColor: () => COLOR.border, vLineColor: () => COLOR.border, hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 2, paddingBottom: () => 2,
        },
        margin: [0, 8, 0, 0],
      },
    ],
  };
}

export async function buildExportPdf(table: ExportTable): Promise<Buffer> {
  const { pdfmake } = getEngine();
  return pdfmake.createPdf(buildExportPdfDocument(table)).getBuffer();
}
