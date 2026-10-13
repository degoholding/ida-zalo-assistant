import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { MetricSourceStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { METRIC_MAX_WARNINGS, type MetricSourceRow } from "./metric-types.js";

// Truy cập bảng metric_source: đọc, giành khóa đọc, ghi kết quả lượt đọc.

/** Khóa đọc quá ngần này (tiến trình chết giữa chừng) thì lượt khác được giành lại. */
export const CLAIM_EXPIRY_MS = 10 * 60_000;

function parseWarnings(raw: unknown): string[] {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return []; }
  }
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseMapping(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function toSourceRow(row: RowDataPacket): MetricSourceRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    spreadsheetId: String(row.spreadsheet_id),
    sheetTitle: String(row.sheet_title),
    headerRow: Number(row.header_row),
    mapping: parseMapping(row.mapping),
    dailyReport: Boolean(row.daily_report),
    isActive: Boolean(row.is_active),
    status: Number(row.status),
    lastSyncAt: row.last_sync_at ?? null,
    lastOkAt: row.last_ok_at ?? null,
    lastError: String(row.last_error ?? ""),
    lastRowCount: Number(row.last_row_count ?? 0),
    lastWarningCount: Number(row.last_warning_count ?? 0),
    lastWarnings: parseWarnings(row.last_warnings),
  };
}

export async function findSource(db: Db, id: number): Promise<MetricSourceRow | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM metric_source WHERE id = ?", [id]);
  return rows[0] ? toSourceRow(rows[0]) : null;
}

export async function listActiveSources(db: Db, tenantId = 1): Promise<MetricSourceRow[]> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM metric_source WHERE tenant_id = ? AND is_active = 1 ORDER BY id", [tenantId]);
  return rows.map(toSourceRow);
}

/** Giành khóa đọc bằng UPDATE có điều kiện; false = nơi khác đang đọc nguồn này. */
export async function claimSource(db: Db, id: number, now: Date): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    "UPDATE metric_source SET sync_started_at = ? WHERE id = ? AND (sync_started_at IS NULL OR sync_started_at < ?)",
    [now, id, new Date(now.getTime() - CLAIM_EXPIRY_MS)],
  );
  return result.affectedRows === 1;
}

export async function releaseSource(db: Db, id: number): Promise<void> {
  await db.query("UPDATE metric_source SET sync_started_at = NULL WHERE id = ?", [id]);
}

export interface SourceResult {
  status: MetricSourceStatus;
  error: string;
  /** null = giữ nguyên số dòng lượt trước (lượt lỗi / bị chặn xóa) */
  rowCount: number | null;
  warnings: string[];
  warningTotal: number;
  /** Lượt thành công → cập nhật last_ok_at */
  ok: boolean;
  at: Date;
}

export async function saveSourceResult(db: Db, id: number, result: SourceResult): Promise<void> {
  await db.query(
    `UPDATE metric_source SET status = ?, last_sync_at = ?, last_ok_at = IF(?, ?, last_ok_at), last_error = ?,
       last_row_count = COALESCE(?, last_row_count), last_warning_count = ?, last_warnings = ? WHERE id = ?`,
    [
      result.status, result.at, result.ok ? 1 : 0, result.at, result.error.slice(0, 500),
      result.rowCount, result.warningTotal, JSON.stringify(result.warnings.slice(0, METRIC_MAX_WARNINGS)), id,
    ],
  );
}
