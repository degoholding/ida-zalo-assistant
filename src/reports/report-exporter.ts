import type { AppConfig } from "../config.js";
import { parseServiceAccount, parseSpreadsheetId } from "../google/service-account.js";
import { GoogleSheetsClient, sheetUrl } from "../google/sheets-client.js";
import { GoogleSheetsError } from "../google/sheets-error-messages.js";
import type { FileStorage } from "../storage/file-storage.js";
import { compactDate, type MeetingRecap } from "./meeting-recap-input.js";
import { renderRecapPdf } from "./meeting-recap-pdf.js";
import { buildReportMatrix, buildReportWorkbook, excelSheetName, reportFileName, type ReportTable } from "./report-table.js";

// Xuất báo cáo của trợ lý ra Google Sheets (tab mới trên trang tính đã kết nối ở màn Cài đặt) hoặc tệp Excel
// cất vào kho — nơi gọi gửi tệp cho người hỏi. «auto» = Sheets nếu đã kết nối, không thì Excel; Sheets lỗi
// thì tự lùi về Excel để người hỏi vẫn có báo cáo.

export type ReportFormat = "auto" | "excel" | "sheets";

/** Tệp (Excel / PDF recap) đã cất vào kho, chờ gửi cho người hỏi. */
export interface GeneratedReportFile {
  fileName: string;
  storageKey: string;
  bytes: number;
}

export interface ReportExportOutcome {
  /** Trả cho mô hình đọc (không chứa bí mật). */
  response: Record<string, unknown>;
  file: GeneratedReportFile | null;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const EXCEL_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Đuôi tệp (không dấu chấm, chữ thường) để ghi tin tệp — «xlsx», «pdf». */
export function reportFileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

/**
 * «Meeting-Recap-Giao-ban-du-an-K52-2026.10.06-v1.0.pdf» (tóm tắt tài liệu: «Tom-tat-…») — theo cách đặt tên của tệp mẫu,
 * bỏ dấu cho Zalo / kho.
 */
export function recapFileName(recap: MeetingRecap, now: Date): string {
  const base = recap.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
    .replace(/^\s*(recap|meeting recap|tom tat)(\s+h[oọ]p)?\b[\s:-]*/i, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "Cuoc-hop";
  const version = recap.version.replace(/[^A-Za-z0-9.]+/g, "") || "v1";
  return `${recap.variant === "meeting" ? "Meeting-Recap" : "Tom-tat"}-${base}-${compactDate(recap.meetingDate, now)}-${version}.pdf`;
}

/** Giờ Việt Nam: chữ để hiện («05/10/2026 17:20») và dấu để đặt tên («20261005-172045»). */
export function vnTimestamp(now: Date): { text: string; stamp: string } {
  const iso = new Date(now.getTime() + VN_OFFSET_MS).toISOString();
  const [date, time] = [iso.slice(0, 10), iso.slice(11, 19)];
  const [year, month, day] = date.split("-");
  return { text: `${day}/${month}/${year} ${time.slice(0, 5)}`, stamp: `${year}${month}${day}-${time.replace(/:/g, "")}` };
}

export class ReportExporter {
  constructor(
    private readonly storage: FileStorage,
    /** Đọc lúc xuất (không chép lúc dựng) — đổi kết nối Google trên màn Cài đặt là có hiệu lực ngay. */
    private readonly getGoogle: () => AppConfig["google"],
    private readonly sheetsClientFactory: (account: ReturnType<typeof parseServiceAccount>) => GoogleSheetsClient = (account) => new GoogleSheetsClient(account),
  ) {}

  get sheetsConnected(): boolean {
    const google = this.getGoogle();
    return Boolean(google.serviceAccount && google.spreadsheetUrl);
  }

  async export(table: ReportTable, format: ReportFormat, now: Date): Promise<ReportExportOutcome> {
    const useSheets = format === "sheets" || (format === "auto" && this.sheetsConnected);
    if (!useSheets) return this.exportExcel(table, now);
    if (!this.sheetsConnected) {
      return { response: { error: "Google Sheets chưa kết nối (quản trị dán khóa service account + link trang tính ở màn Cài đặt). Có thể xuất Excel thay." }, file: null };
    }
    try {
      return await this.exportSheets(table, now);
    } catch (error) {
      if (!(error instanceof GoogleSheetsError)) throw error;
      // Sheets hỏng (chưa chia sẻ, hết hạn mức…) mà người hỏi không đòi riêng Sheets: vẫn đưa Excel
      if (format === "sheets") return { response: { error: `Ghi Google Sheets lỗi: ${error.message}` }, file: null };
      const fallback = await this.exportExcel(table, now);
      return { ...fallback, response: { ...fallback.response, note: `Ghi Google Sheets lỗi (${error.message}) nên đã xuất Excel thay.` } };
    }
  }

  /** Dựng PDF recap cuộc họp theo mẫu công ty, cất kho — nơi gọi gửi tệp cho người hỏi / vào nhóm. */
  async exportRecapPdf(recap: MeetingRecap, now: Date): Promise<ReportExportOutcome> {
    const data = await renderRecapPdf(recap);
    const fileName = recapFileName(recap, now);
    const { stamp } = vnTimestamp(now);
    // Dấu giờ trong khóa kho: hai bản recap cùng tên cuộc họp không đè nhau
    const storageKey = await this.storage.put(`reports/${stamp.slice(0, 6)}/${stamp}-${fileName}`, data, "application/pdf");
    return {
      response: { format: "pdf", file_name: fileName, tasks: recap.tasks.length, will_send_file: true },
      file: { fileName, storageKey, bytes: data.length },
    };
  }

  private async exportExcel(table: ReportTable, now: Date): Promise<ReportExportOutcome> {
    const { text, stamp } = vnTimestamp(now);
    const data = buildReportWorkbook(table, text);
    const fileName = reportFileName(table.title, stamp);
    const storageKey = await this.storage.put(`reports/${stamp.slice(0, 6)}/${fileName}`, data, EXCEL_CONTENT_TYPE);
    return {
      response: { format: "excel", file_name: fileName, rows: table.rows.length, will_send_file: true },
      file: { fileName, storageKey, bytes: data.length },
    };
  }

  private async exportSheets(table: ReportTable, now: Date): Promise<ReportExportOutcome> {
    const google = this.getGoogle();
    const spreadsheetId = parseSpreadsheetId(google.spreadsheetUrl);
    const client = this.sheetsClientFactory(parseServiceAccount(google.serviceAccount));
    const { text, stamp } = vnTimestamp(now);
    // Mỗi báo cáo một tab mới, tên kèm giờ để không trùng tab cũ
    const sheetTitle = `${excelSheetName(table.title).slice(0, 80)} ${stamp}`;
    const sheetId = await client.addSheet(spreadsheetId, sheetTitle);
    await client.appendRows(spreadsheetId, sheetTitle, buildReportMatrix(table, text));
    return {
      response: { format: "sheets", link: sheetUrl(spreadsheetId, sheetId), sheet_title: sheetTitle, rows: table.rows.length },
      file: null,
    };
  }
}
