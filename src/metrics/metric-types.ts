import type { MetricSourceStatus } from "../constants.js";

// Kiểu dùng chung của lõi số liệu N3 (phase 4). Hình ánh xạ cột xem metric-mapping.ts.

/** Cách gộp hai dòng cùng (ngày, nhân viên, khu vực) trong một bảng: cộng dồn hay lấy dòng dưới cùng. */
export type MetricAggregate = "sum" | "last";

export interface MetricDef {
  code: string;
  label: string;
  /** Chữ tiêu đề cột HOẶC chữ cột A…ZZ */
  column: string;
  unit: string;
  aggregate: MetricAggregate;
}

export interface MetricMapping {
  date: string;
  staff: string;
  staffBy: "name" | "code";
  area: string | null;
  metrics: MetricDef[];
}

/** Một bản ghi số liệu đã đọc từ bảng (chưa ghi DB). `baseFlags` = bit Unparsed | UnknownStaff; cờ ±30% / âm tính sau. */
export interface MetricRecord {
  date: string;
  staffKey: string;
  staffName: string;
  catalogEntryId: number | null;
  areaKey: string;
  areaName: string;
  code: string;
  value: number | null;
  raw: string;
  row: number;
  baseFlags: number;
}

/** Dòng bảng `metric_source` (đã chuẩn hóa kiểu). */
export interface MetricSourceRow {
  id: number;
  name: string;
  spreadsheetId: string;
  sheetTitle: string;
  headerRow: number;
  mapping: unknown;
  dailyReport: boolean;
  isActive: boolean;
  status: MetricSourceStatus;
  lastSyncAt: Date | null;
  lastOkAt: Date | null;
  lastError: string;
  lastRowCount: number;
  lastWarningCount: number;
  lastWarnings: string[];
}

/** Ánh xạ sai / bảng không khớp — KHÔNG ghi số, giữ số cũ, trạng thái nguồn = MappingError. */
export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappingError";
  }
}

/** Cửa sổ lưu giữ / cập nhật số liệu (ngày). Dòng cũ hơn không đọc, không xóa. */
export const METRIC_WINDOW_DAYS = 62;
/** Trần số dòng đọc một lượt / nguồn. */
export const METRIC_MAX_ROWS = 20_000;
/** Số câu cảnh báo giữ lại. */
export const METRIC_MAX_WARNINGS = 20;
