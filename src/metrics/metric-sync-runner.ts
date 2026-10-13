import { MetricSourceStatus } from "../constants.js";
import type { AppConfig } from "../config.js";
import type { Db } from "../db/pool.js";
import { GoogleSheetsClient } from "../google/sheets-client.js";
import { parseServiceAccount } from "../google/service-account.js";
import { createLogger } from "../logger.js";
import { vnLocalTime, type WorkCalendar } from "../schedule/work-calendar.js";
import { listActiveSources } from "./metric-source-repository.js";
import { syncSource, type MetricSyncDeps, type SyncOutcome } from "./metric-sync-service.js";

// Việc nền «metrics-sync» (30 phút, trong giờ làm) và «metrics-close» (18:00 ngày làm việc): đọc tuần tự mọi nguồn đang bật.

const log = createLogger("metrics");
/** Lịch cài sai: đọc trong 08:00–18:00. */
const FALLBACK_START_MINUTE = 8 * 60;
const FALLBACK_END_MINUTE = 18 * 60;

let cachedClient: { account: unknown; client: GoogleSheetsClient } | null = null;
let warnedNoKey = false;

/**
 * Client Sheets từ khóa service account trong cài đặt (đọc lại mỗi lần gọi — dán / xóa khóa có hiệu lực ngay). Giữ client để
 * dùng lại access token đã đệm. null = chưa có khóa hoặc khóa hỏng.
 */
export function metricsSheetsClient(config: AppConfig): GoogleSheetsClient | null {
  const account = config.google.serviceAccount;
  if (!account) return null;
  if (cachedClient?.account === account) return cachedClient.client;
  try {
    cachedClient = { account, client: new GoogleSheetsClient(parseServiceAccount(account)) };
    return cachedClient.client;
  } catch {
    cachedClient = null;
    return null;
  }
}

export function metricsDeps(db: Db, config: AppConfig): MetricSyncDeps {
  return { db, getClient: () => metricsSheetsClient(config) };
}

function withinReadingHours(now: Date, calendar: WorkCalendar | null): boolean {
  if (calendar) return calendar.isWorkingTime(now);
  const minute = vnLocalTime(now).minuteOfDay;
  return minute >= FALLBACK_START_MINUTE && minute < FALLBACK_END_MINUTE;
}

/** `close` = lượt chốt 18:00: chạy bất kể giờ làm (lịch hẹn đã lo ngày làm việc). */
export async function runMetricsSync(
  db: Db, config: AppConfig, calendar: WorkCalendar | null, mode: "sync" | "close", now: Date = new Date(),
): Promise<SyncOutcome[]> {
  if (mode === "sync" && !withinReadingHours(now, calendar)) return [];
  try {
    const sources = await listActiveSources(db);
    if (sources.length === 0) return [];
    const deps = metricsDeps(db, config);
    if (!deps.getClient()) {
      // Vẫn gọi syncSource để mỗi nguồn ghi câu «chưa có khóa» lên màn Nguồn số liệu; log một lần
      if (!warnedNoKey) log.warn("có nguồn số liệu đang bật nhưng chưa có khóa service account — bỏ qua đọc bảng");
      warnedNoKey = true;
    } else {
      warnedNoKey = false;
    }
    const outcomes: SyncOutcome[] = [];
    for (const source of sources) {
      outcomes.push(await syncSource(deps, source.id, now));
    }
    const failed = outcomes.filter((o) => !o.skipped && o.status !== MetricSourceStatus.Ok).length;
    log.info(`đọc ${sources.length} nguồn số liệu (${mode}): ${outcomes.reduce((n, o) => n + o.records, 0)} số, ${failed} nguồn lỗi`);
    return outcomes;
  } catch (error) {
    log.error("việc nền số liệu lỗi", error);
    return [];
  }
}
