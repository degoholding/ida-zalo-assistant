import { ReportInputError, normalizeReportTable, type ReportTable } from "../reports/report-table.js";
import type { ReportFormat } from "../reports/report-exporter.js";
import type { FunctionDeclaration } from "./gemini-client.js";

// Công cụ export_report: mô hình soạn báo cáo thành MỘT bảng rồi gọi công cụ này để xuất ra Google Sheets
// (tab mới, trả link) hoặc tệp Excel (gửi cho chính người hỏi sau câu trả lời). Chỉ ghi ra trang tính của
// công ty / gửi cho người hỏi — không gửi cho ai khác.

export type ExportReport = (table: ReportTable, format: ReportFormat) => Promise<Record<string, unknown>>;

export const EXPORT_REPORT_DECLARATION: FunctionDeclaration = {
  name: "export_report",
  description:
    "Xuất báo cáo ra FILE khi người hỏi muốn báo cáo dạng Excel / Google Sheets / bảng / file. Lấy dữ liệu bằng các công cụ khác " +
    "TRƯỚC, soạn thành MỘT bảng (mỗi dòng một mục: một nhóm, một việc, một khoản…), rồi gọi công cụ này MỘT lần. " +
    "Kết quả: Google Sheets trả link (đưa link cho người hỏi); Excel thì tệp tự gửi cho người hỏi sau câu trả lời. " +
    "Sau khi xuất, câu trả lời chỉ tóm 2–4 ý chính, không chép lại cả bảng.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Tiêu đề báo cáo, vd 'Báo cáo tình hình các nhóm 02/10–05/10'" },
      notes: { type: "array", items: { type: "string" }, description: "Vài dòng tóm tắt / kết luận đặt trên bảng (tùy chọn)" },
      columns: { type: "array", items: { type: "string" }, description: "Tên các cột, vd ['Nhóm','Tiến độ','Vấn đề','Việc còn treo','Phụ trách']" },
      rows: {
        type: "array",
        items: { type: "array", items: { type: "string" } },
        description: "Các dòng; mỗi dòng là mảng ô theo ĐÚNG thứ tự columns",
      },
      format: {
        type: "string",
        enum: ["auto", "excel", "sheets"],
        description: "auto (mặc định: Google Sheets nếu đã kết nối, không thì Excel); excel hoặc sheets khi người hỏi nói rõ",
      },
    },
    required: ["title", "columns", "rows"],
  },
};

const FORMATS = new Set<ReportFormat>(["auto", "excel", "sheets"]);

export async function runExportReport(exportReport: ExportReport | undefined, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!exportReport) return { error: "Xuất báo cáo chưa bật cho trợ lý này." };
  let table: ReportTable;
  try {
    table = normalizeReportTable(args);
  } catch (error) {
    if (error instanceof ReportInputError) return { error: error.message };
    throw error;
  }
  const format = FORMATS.has(args.format as ReportFormat) ? (args.format as ReportFormat) : "auto";
  return exportReport(table, format);
}
