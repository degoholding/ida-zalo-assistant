import type { Db } from "../db/pool.js";
import type { GoogleSheetsClient } from "../google/sheets-client.js";
import { sheetRange } from "../google/sheets-client.js";
import { vnLocalTime } from "../schedule/work-calendar.js";
import { resolveColumns, validateMapping, type ResolvedColumns } from "./metric-mapping.js";
import { extractRecords, type ExtractResult } from "./metric-row-extractor.js";
import { loadStaffIndex } from "./metric-staff-resolver.js";
import { MappingError, METRIC_MAX_ROWS, type MetricMapping } from "./metric-types.js";

// Đọc bảng + ánh xạ + trích bản ghi — dùng chung cho lượt đọc thật (ghi DB) và «Kiểm tra đọc thử» (không ghi).

export interface SourceConfig {
  spreadsheetId: string;
  sheetTitle: string;
  headerRow: number;
  mapping: unknown;
}

export interface ReadOutcome extends ExtractResult {
  mapping: MetricMapping;
  columns: ResolvedColumns;
  /** Số dòng dữ liệu (sau dòng tiêu đề) Google trả về */
  sheetRows: number;
}

/** Ném MappingError khi cấu hình / tiêu đề không khớp; GoogleSheetsError khi Google từ chối. */
export async function readSource(db: Db, client: GoogleSheetsClient, config: SourceConfig, now: Date): Promise<ReadOutcome> {
  if (!config.spreadsheetId || !config.sheetTitle) throw new MappingError("Nguồn chưa có link bảng hoặc tên tab.");
  const headerRow = Math.max(1, Math.floor(config.headerRow) || 1);
  const validated = validateMapping(config.mapping);
  if (!validated.ok) throw new MappingError(validated.error);
  // +2: dòng tiêu đề thêm một dòng để phát hiện bảng vượt trần
  const rows = await client.getValues(config.spreadsheetId, sheetRange(config.sheetTitle, `A1:ZZ${headerRow + METRIC_MAX_ROWS + 1}`));
  const header = rows[headerRow - 1];
  if (!header || header.every((cell) => String(cell ?? "").trim() === "")) {
    throw new MappingError(`Tab «${config.sheetTitle}» không có dòng tiêu đề ở dòng ${headerRow} (tab trống hoặc sai tên tab / dòng tiêu đề).`);
  }
  const resolved = resolveColumns(header, validated.mapping, headerRow);
  if (!resolved.ok) throw new MappingError(resolved.error);
  const staffIndex = await loadStaffIndex(db);
  const extracted = extractRecords(rows, resolved.columns, validated.mapping.staffBy, headerRow, staffIndex, vnLocalTime(now).date);
  return { ...extracted, mapping: validated.mapping, columns: resolved.columns, sheetRows: Math.max(0, rows.length - headerRow) };
}
