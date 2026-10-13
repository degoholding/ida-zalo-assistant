import { parseSpreadsheetId } from "../../google/service-account.js";
import { validateMapping } from "../../metrics/metric-mapping.js";
import type { MetricMapping } from "../../metrics/metric-types.js";
import { ApiError } from "./api-http.js";

// Đọc + kiểm thân JSON của «Nguồn số liệu» (thêm / sửa / đọc thử). Hàm thuần, ném ApiError 422 bằng câu tiếng Việt.

export const SHEET_TITLE_MAX = 150;
export const SOURCE_NAME_MAX = 150;
export const HEADER_ROW_MAX = 100;

export interface SourceDraft {
  name?: string;
  spreadsheetId?: string;
  sheetTitle?: string;
  headerRow?: number;
  /** Dạng chuẩn lưu vào cột `mapping` (khóa snake_case, khớp `validateMapping`) */
  mapping?: StoredMapping;
  dailyReport?: boolean;
  isActive?: boolean;
}

export interface StoredMapping {
  date: string;
  staff: string;
  staff_by: "name" | "code";
  area: string;
  metrics: { code: string; label: string; column: string; unit: string; aggregate: "sum" | "last" }[];
}

function invalid(message: string): ApiError {
  return new ApiError(422, "validation_error", message);
}

function readText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw invalid(`${label} không hợp lệ`);
  const text = value.trim();
  if (text.length > max) throw invalid(`${label} tối đa ${max} ký tự`);
  return text;
}

/** Ánh xạ người dùng gõ → dạng lưu chuẩn; sai thì 422 kèm câu của `validateMapping`. */
export function toStoredMapping(raw: unknown): StoredMapping {
  const result = validateMapping(raw);
  if (!result.ok) throw invalid(result.error);
  const mapping: MetricMapping = result.mapping;
  return {
    date: mapping.date, staff: mapping.staff, staff_by: mapping.staffBy, area: mapping.area ?? "",
    metrics: mapping.metrics.map((def) => ({ code: def.code, label: def.label, column: def.column, unit: def.unit, aggregate: def.aggregate })),
  };
}

function readBool(value: unknown, label: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  throw invalid(`${label} không hợp lệ`);
}

/**
 * `requireAll` = thêm mới / đọc thử: đủ tên tab, link, ánh xạ. PATCH chỉ kiểm trường gửi lên.
 * Link nhận ở `spreadsheet_url` (hoặc `spreadsheet_id`), dán link đầy đủ hay mã trần đều được.
 */
export function parseSourceDraft(body: Record<string, unknown>, requireAll: boolean): SourceDraft {
  const draft: SourceDraft = {};
  if (body.name !== undefined) {
    draft.name = readText(body.name, "Tên nguồn", SOURCE_NAME_MAX);
    if (!draft.name) throw invalid("Chưa nhập tên nguồn");
  }
  const link = body.spreadsheet_url ?? body.spreadsheet_id;
  if (link !== undefined) {
    if (typeof link !== "string") throw invalid("Link bảng không hợp lệ");
    draft.spreadsheetId = parseSpreadsheetId(link);
  }
  if (body.sheet_title !== undefined) {
    draft.sheetTitle = readText(body.sheet_title, "Tên tab", SHEET_TITLE_MAX);
    if (!draft.sheetTitle) throw invalid("Chưa nhập tên tab");
  }
  if (body.header_row !== undefined && body.header_row !== "") {
    const row = Number(body.header_row);
    if (!Number.isInteger(row) || row < 1 || row > HEADER_ROW_MAX) throw invalid(`Dòng tiêu đề từ 1 đến ${HEADER_ROW_MAX}`);
    draft.headerRow = row;
  }
  if (body.mapping !== undefined) draft.mapping = toStoredMapping(body.mapping);
  if (body.daily_report !== undefined) draft.dailyReport = readBool(body.daily_report, "«Báo hằng ngày»");
  if (body.is_active !== undefined) draft.isActive = readBool(body.is_active, "«Đang đọc»");
  if (requireAll) {
    if (draft.spreadsheetId === undefined) throw invalid("Chưa dán link bảng");
    if (draft.sheetTitle === undefined) throw invalid("Chưa nhập tên tab");
    if (draft.mapping === undefined) throw invalid("Chưa khai ánh xạ cột");
  }
  return draft;
}
