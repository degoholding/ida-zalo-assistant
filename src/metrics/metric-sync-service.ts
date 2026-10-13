import { MetricSourceStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { GoogleSheetsClient } from "../google/sheets-client.js";
import { GoogleSheetsError } from "../google/sheets-error-messages.js";
import { createLogger, describeError } from "../logger.js";
import { vnLocalTime } from "../schedule/work-calendar.js";
import { windowFromIso } from "./metric-row-extractor.js";
import { readSource, type SourceConfig } from "./metric-source-reader.js";
import { claimSource, findSource, releaseSource, saveSourceResult } from "./metric-source-repository.js";
import { MappingError, METRIC_MAX_WARNINGS, type MetricRecord } from "./metric-types.js";
import { applyFlags, removeVanished, upsertRecords } from "./metric-value-store.js";

// Một lượt đọc một nguồn: claim → đọc bảng → ánh xạ → upsert → dọn dòng đã xóa → cờ → ghi trạng thái. KHÔNG ném ra ngoài:
// mọi lỗi thành trạng thái của nguồn để việc nền không sập.

const log = createLogger("metrics");

export interface MetricSyncDeps {
  db: Db;
  /** null = chưa cấu hình khóa service account */
  getClient: () => GoogleSheetsClient | null;
}

export interface SyncOutcome {
  sourceId: number;
  /** true = nơi khác đang đọc nguồn này, bỏ lượt */
  skipped: boolean;
  status: MetricSourceStatus;
  error: string;
  records: number;
  removed: number;
  warnings: string[];
  warningTotal: number;
}

const NO_CLIENT_TEXT = "Chưa dán khóa service account ở màn Cài đặt (mục Google).";

function outcome(sourceId: number, patch: Partial<SyncOutcome>): SyncOutcome {
  return { sourceId, skipped: false, status: MetricSourceStatus.Ok, error: "", records: 0, removed: 0, warnings: [], warningTotal: 0, ...patch };
}

/** `acceptShrink`: quản trị bấm «Đọc ngay» = chấp nhận bảng co lại thật (IDA dọn bớt dòng) — bỏ chốt «ít hơn 50% lượt trước»,
 * vẫn giữ chốt «đọc ra 0 số» (bảng trống / sai tab thì không bao giờ xóa sạch số cũ). Việc nền không bao giờ đặt cờ này. */
export interface SyncOptions {
  acceptShrink?: boolean;
}

export async function syncSource(deps: MetricSyncDeps, sourceId: number, now: Date = new Date(), options: SyncOptions = {}): Promise<SyncOutcome> {
  const { db } = deps;
  let claimed = false;
  try {
    const source = await findSource(db, sourceId);
    if (!source) return outcome(sourceId, { status: MetricSourceStatus.Failed, error: "Không thấy nguồn số liệu." });
    claimed = await claimSource(db, sourceId, now);
    if (!claimed) return outcome(sourceId, { skipped: true, status: source.status, error: "Nguồn đang được đọc ở nơi khác." });
    const fail = async (status: MetricSourceStatus, error: string) => {
      await saveSourceResult(db, sourceId, { status, error, rowCount: null, warnings: [], warningTotal: 0, ok: false, at: now });
      return outcome(sourceId, { status, error });
    };
    const client = deps.getClient();
    if (!client) return await fail(MetricSourceStatus.Failed, NO_CLIENT_TEXT);
    try {
      const config: SourceConfig = { spreadsheetId: source.spreadsheetId, sheetTitle: source.sheetTitle, headerRow: source.headerRow, mapping: source.mapping };
      const read = await readSource(db, client, config, now);
      const todayIso = vnLocalTime(now).date;
      await upsertRecords(db, sourceId, read.records, now, source.lastOkAt === null, todayIso);
      const removal = await removeVanished(db, sourceId, windowFromIso(todayIso), now, read.records.length, options.acceptShrink ? 0 : source.lastRowCount);
      await applyFlags(db, sourceId, windowFromIso(todayIso));
      const warnings = [...read.warnings];
      if (removal.blocked && warnings.length < METRIC_MAX_WARNINGS) {
        warnings.push(`Bảng đọc ra ${read.records.length} số, quá ít so với lượt trước (${source.lastRowCount}) — giữ nguyên số cũ, chưa xóa dòng nào. Kiểm tra lại tab / bảng; nếu bảng thật sự đã bớt dòng thì bấm «Đọc ngay» để chấp nhận.`);
      }
      await saveSourceResult(db, sourceId, {
        status: MetricSourceStatus.Ok, error: "", rowCount: removal.blocked ? null : read.records.length,
        warnings, warningTotal: read.warningTotal + (removal.blocked ? 1 : 0), ok: true, at: now,
      });
      return outcome(sourceId, { records: read.records.length, removed: removal.removed, warnings, warningTotal: read.warningTotal });
    } catch (error) {
      if (error instanceof MappingError) return await fail(MetricSourceStatus.MappingError, error.message);
      if (error instanceof GoogleSheetsError) return await fail(MetricSourceStatus.Failed, error.message);
      log.error(`nguồn ${sourceId}: lỗi nội bộ khi đọc`, error);
      return await fail(MetricSourceStatus.Failed, "Lỗi nội bộ khi đọc bảng — xem nhật ký máy chủ.");
    }
  } catch (error) {
    log.error(`nguồn ${sourceId}: lượt đọc hỏng`, describeError(error));
    return outcome(sourceId, { status: MetricSourceStatus.Failed, error: "Lỗi nội bộ khi đọc bảng — xem nhật ký máy chủ." });
  } finally {
    if (claimed) await releaseSource(db, sourceId).catch((error) => log.error(`nguồn ${sourceId}: không nhả được khóa đọc`, error));
  }
}

export interface PreviewResult {
  ok: boolean;
  status: MetricSourceStatus;
  error: string;
  /** Tiêu đề thấy ở dòng tiêu đề */
  headers: string[];
  /** Chỉ tiêu → tiêu đề cột đã khớp */
  matched: { label: string; code: string; column: string }[];
  sample: MetricRecord[];
  recordCount: number;
  sheetRows: number;
  outOfWindow: number;
  warnings: string[];
  warningTotal: number;
}

const emptyPreview = (status: MetricSourceStatus, error: string): PreviewResult => ({
  ok: false, status, error, headers: [], matched: [], sample: [], recordCount: 0, sheetRows: 0, outOfWindow: 0, warnings: [], warningTotal: 0,
});

/** «Kiểm tra đọc thử»: nhận cấu hình CHƯA lưu, đọc + ánh xạ nhưng KHÔNG ghi DB. Không ném ra ngoài. */
export async function previewSource(deps: MetricSyncDeps, draft: SourceConfig, now: Date = new Date()): Promise<PreviewResult> {
  const client = deps.getClient();
  if (!client) return emptyPreview(MetricSourceStatus.Failed, NO_CLIENT_TEXT);
  try {
    const read = await readSource(deps.db, client, draft, now);
    return {
      ok: true, status: MetricSourceStatus.Ok, error: "",
      headers: read.columns.headers,
      matched: read.columns.metrics.map(({ def, index }) => ({ label: def.label, code: def.code, column: read.columns.headers[index] || `cột ${index + 1}` })),
      sample: read.records.slice(0, 10), recordCount: read.records.length, sheetRows: read.sheetRows,
      outOfWindow: read.outOfWindow, warnings: read.warnings, warningTotal: read.warningTotal,
    };
  } catch (error) {
    if (error instanceof MappingError) return emptyPreview(MetricSourceStatus.MappingError, error.message);
    if (error instanceof GoogleSheetsError) return emptyPreview(MetricSourceStatus.Failed, error.message);
    log.error("đọc thử lỗi nội bộ", error);
    return emptyPreview(MetricSourceStatus.Failed, "Lỗi nội bộ khi đọc thử — xem nhật ký máy chủ.");
  }
}
