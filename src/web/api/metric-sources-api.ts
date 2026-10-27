import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { MetricSourceStatus } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { parseServiceAccount } from "../../google/service-account.js";
import { toSourceRow } from "../../metrics/metric-source-repository.js";
import { validateMapping } from "../../metrics/metric-mapping.js";
import { metricsDeps } from "../../metrics/metric-sync-runner.js";
import { previewSource, syncSource } from "../../metrics/metric-sync-service.js";
import type { MetricSourceRow, MetricRecord } from "../../metrics/metric-types.js";
import type { SyncService } from "../../sync-service.js";
import { ApiError, parseId, readJson, sendOk } from "./api-http.js";
import type { ApiRoute } from "./api-route.js";
import { recordAudit } from "./audit-log.js";
import type { ListSpec } from "./list-query.js";
import { runList } from "./list-runner.js";
import { parseSourceDraft, type SourceDraft } from "./metric-source-input.js";

// Màn "Nguồn số liệu" (phase 8, phase 10): CRUD nguồn bảng Google + "Kiểm tra đọc thử" + "Đọc ngay". KHÔNG khai luật ở
// route-permissions.ts nên mọi route ở đây chỉ quản trị gọi được. Không bao giờ trả khóa service account — chỉ email của nó
// (để quản trị biết chia sẻ bảng cho ai).

export const METRIC_SOURCE_LIST_SPEC: ListSpec = {
  fields: {
    name: { sql: "s.name", type: "text" },
    status: { sql: "s.status", type: "number" },
    is_active: { sql: "s.is_active", type: "boolean" },
    daily_report: { sql: "s.daily_report", type: "boolean" },
  },
  sorts: { name: "s.name", status: "s.status", last_sync_at: "s.last_sync_at", last_ok_at: "s.last_ok_at", created_at: "s.created_at" },
  defaultSort: { by: "created_at", dir: "desc" },
  tieBreaker: "s.id",
  search: { param: "q", columns: ["s.name", "s.sheet_title"] },
};

const SOURCE_FROM = "FROM metric_source s";
const SOURCE_ENTITY = "metric_source" as const;
const FIELD_LABELS: Record<string, string> = {
  name: "Tên nguồn", spreadsheetId: "Link bảng", sheetTitle: "Tab", headerRow: "Dòng tiêu đề", mapping: "Ánh xạ cột",
  dailyReport: "Báo hằng ngày", isActive: "Đang đọc",
};

/** Email service account (không phải khóa) — rỗng khi chưa dán hoặc khóa hỏng. */
export function serviceAccountEmail(service: SyncService): string {
  const raw = service.config.google.serviceAccount;
  if (!raw) return "";
  try { return parseServiceAccount(raw).client_email; } catch { return ""; }
}

export function toSourceApi(source: MetricSourceRow): Record<string, unknown> {
  const mapping = validateMapping(source.mapping);
  return {
    id: source.id, name: source.name, spreadsheet_id: source.spreadsheetId,
    spreadsheet_url: source.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit` : "",
    sheet_title: source.sheetTitle, header_row: source.headerRow, mapping: source.mapping,
    metric_count: mapping.ok ? mapping.mapping.metrics.length : 0,
    daily_report: source.dailyReport, is_active: source.isActive, status: source.status,
    last_sync_at: source.lastSyncAt, last_ok_at: source.lastOkAt, last_error: source.lastError,
    last_row_count: source.lastRowCount, last_warning_count: source.lastWarningCount, last_warnings: source.lastWarnings,
  };
}

async function loadSource(db: Db, id: number, tenantId: number): Promise<MetricSourceRow> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM metric_source WHERE id = ? AND tenant_id = ?", [id, tenantId]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Không có nguồn số liệu này");
  return toSourceRow(rows[0]);
}

function requireClient(service: SyncService): void {
  if (!metricsDeps(service.db, service.config).getClient()) {
    throw new ApiError(422, "validation_error", "Dán khóa service account ở Cài đặt → Google trước");
  }
}

const COLUMN_BY_FIELD: Record<string, string> = {
  name: "name", spreadsheetId: "spreadsheet_id", sheetTitle: "sheet_title", headerRow: "header_row",
  mapping: "mapping", dailyReport: "daily_report", isActive: "is_active",
};

/** Trường đổi "hình" bảng đọc ra — đổi thì bỏ mốc số dòng lượt trước. */
const SHAPE_FIELDS = new Set(["spreadsheetId", "sheetTitle", "headerRow", "mapping"]);

function draftValue(key: string, draft: SourceDraft): unknown {
  const value = draft[key as keyof SourceDraft];
  if (key === "mapping") return JSON.stringify(value);
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}

function sampleToApi(record: MetricRecord): Record<string, unknown> {
  return {
    row: record.row, date: record.date, staff_name: record.staffName, area_name: record.areaName, code: record.code,
    value: record.value, raw: record.raw, flags: record.baseFlags, in_catalog: record.catalogEntryId !== null,
  };
}

async function runSyncNow(service: SyncService, source: MetricSourceRow): Promise<Record<string, unknown>> {
  requireClient(service);
  // "Đọc ngay" của quản trị chấp nhận bảng co lại thật (cảnh báo "quá ít so với lượt trước" trên màn này) — xem SyncOptions
  const outcome = await syncSource(metricsDeps(service.db, service.config), source.id, new Date(), { acceptShrink: true });
  if (outcome.skipped) throw new ApiError(409, "conflict", "Nguồn đang được đọc ở nơi khác — thử lại sau ít phút");
  const message = outcome.status === MetricSourceStatus.Ok ? `Đọc ngay: ${outcome.records} số, bỏ ${outcome.removed} dòng đã xóa` : `Đọc ngay lỗi: ${outcome.error}`;
  await recordAudit(service.db, { entity: SOURCE_ENTITY, entityId: source.id, action: "update", message });
  if (outcome.status !== MetricSourceStatus.Ok) {
    throw new ApiError(422, outcome.status === MetricSourceStatus.MappingError ? "mapping_error" : "google_sheets_error", outcome.error);
  }
  return { records: outcome.records, removed: outcome.removed, warnings: outcome.warnings, warning_total: outcome.warningTotal };
}

export const metricSourceRoutes: ApiRoute[] = [
  ["GET", /^\/api\/metric-sources$/, async ({ response, url, service, principal }) => {
    const list = await runList(service.db, url.searchParams, METRIC_SOURCE_LIST_SPEC, {
      select: "s.*", from: SOURCE_FROM, baseWhere: { sql: "s.tenant_id = ?", params: [principal.tenantId] },
      decorate: (rows) => rows.map((row) => toSourceApi(toSourceRow(row))),
    });
    sendOk(response, { ...list, service_account_email: serviceAccountEmail(service) });
  }],

  ["POST", /^\/api\/metric-sources\/preview$/, async ({ request, response, service, principal }) => {
    const body = await readJson(request);
    const draft = parseSourceDraft(body, true);
    requireClient(service);
    const result = await previewSource(metricsDeps(service.db, service.config), {
      spreadsheetId: draft.spreadsheetId ?? "", sheetTitle: draft.sheetTitle ?? "", headerRow: draft.headerRow ?? 1, mapping: draft.mapping,
    });
    const sourceId = Number(body.source_id);
    if (Number.isSafeInteger(sourceId) && sourceId > 0) {
      await loadSource(service.db, sourceId, principal.tenantId);
      await recordAudit(service.db, {
        entity: SOURCE_ENTITY, entityId: sourceId, action: "test_connection",
        message: result.ok ? `Kiểm tra đọc thử: khớp ${result.matched.length} cột, ${result.recordCount} số` : `Kiểm tra đọc thử lỗi: ${result.error}`,
      });
    }
    // Lỗi phía Google (quyền, tab sai tên, mạng) → 422; ánh xạ không khớp tiêu đề thì trả 200 để khung đọc thử hiện câu lỗi tại chỗ
    if (!result.ok && result.status === MetricSourceStatus.Failed) throw new ApiError(422, "google_sheets_error", result.error);
    sendOk(response, {
      ok: result.ok, status: result.status, error: result.error, headers: result.headers, matched: result.matched,
      sample: result.sample.map(sampleToApi), record_count: result.recordCount, sheet_rows: result.sheetRows,
      out_of_window: result.outOfWindow, warnings: result.warnings, warning_total: result.warningTotal,
    });
  }],

  ["GET", /^\/api\/metric-sources\/(\d+)$/, async ({ response, match, service, principal }) =>
    sendOk(response, { ...toSourceApi(await loadSource(service.db, parseId(match[1]), principal.tenantId)), service_account_email: serviceAccountEmail(service) })],

  ["POST", /^\/api\/metric-sources$/, async ({ request, response, service, principal }) => {
    const draft = parseSourceDraft(await readJson(request), true);
    if (!draft.name) throw new ApiError(422, "validation_error", "Chưa nhập tên nguồn");
    const [result] = await service.db.query<ResultSetHeader>(
      `INSERT INTO metric_source (tenant_id, name, spreadsheet_id, sheet_title, header_row, mapping, daily_report, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [principal.tenantId, draft.name, draft.spreadsheetId, draft.sheetTitle, draft.headerRow ?? 1, JSON.stringify(draft.mapping), draft.dailyReport ? 1 : 0, draft.isActive === false ? 0 : 1],
    );
    await recordAudit(service.db, { entity: SOURCE_ENTITY, entityId: result.insertId, action: "create", message: `Thêm nguồn "${draft.name}"` });
    sendOk(response, toSourceApi(await loadSource(service.db, result.insertId, principal.tenantId)), "Đã thêm nguồn số liệu", 201);
  }],

  ["PATCH", /^\/api\/metric-sources\/(\d+)$/, async ({ request, response, match, service, principal }) => {
    const id = parseId(match[1]);
    const draft = parseSourceDraft(await readJson(request), false);
    await loadSource(service.db, id, principal.tenantId);
    const keys = Object.keys(COLUMN_BY_FIELD).filter((key) => draft[key as keyof SourceDraft] !== undefined);
    if (keys.length > 0) {
      // Đổi bảng / tab / dòng tiêu đề / ánh xạ: số dòng lượt trước không còn so được — xóa mốc để chốt chống xóa nhầm (đọc ra < 50%
      // lượt trước thì không dọn) không chặn mãi nguồn vừa đổi sang bảng nhỏ hơn
      const resetCount = keys.some((key) => SHAPE_FIELDS.has(key)) ? ", last_row_count = 0" : "";
      await service.db.query(
        `UPDATE metric_source SET ${keys.map((key) => `${COLUMN_BY_FIELD[key]} = ?`).join(", ")}${resetCount} WHERE id = ? AND tenant_id = ?`,
        [...keys.map((key) => draftValue(key, draft)), id, principal.tenantId],
      );
      await recordAudit(service.db, { entity: SOURCE_ENTITY, entityId: id, action: "update", changedFields: keys.map((key) => FIELD_LABELS[key]) });
    }
    sendOk(response, toSourceApi(await loadSource(service.db, id, principal.tenantId)), keys.length ? "Đã lưu nguồn số liệu" : "Không có gì thay đổi");
  }],

  ["POST", /^\/api\/metric-sources\/(\d+)\/actions$/, async ({ request, response, match, service, principal }) => {
    const id = parseId(match[1]);
    const action = String((await readJson(request)).action ?? "");
    const source = await loadSource(service.db, id, principal.tenantId);
    if (action === "sync_now") {
      const result = await runSyncNow(service, source);
      sendOk(response, result, `Đã đọc ${String(result.records)} số`);
      return;
    }
    if (action !== "enable" && action !== "disable") throw new ApiError(422, "validation_error", "Thao tác không hợp lệ");
    await service.db.query("UPDATE metric_source SET is_active = ? WHERE id = ?", [action === "enable" ? 1 : 0, id]);
    await recordAudit(service.db, { entity: SOURCE_ENTITY, entityId: id, action: action === "enable" ? "activate" : "deactivate", message: `${action === "enable" ? "Bật" : "Tắt"} đọc nguồn "${source.name}"` });
    sendOk(response, toSourceApi(await loadSource(service.db, id, principal.tenantId)), action === "enable" ? "Đã bật đọc nguồn" : "Đã tắt đọc nguồn");
  }],

  // Xóa nguồn kéo theo số đã đọc của nguồn (ON DELETE CASCADE) — muốn giữ số cũ thì dùng "Tắt"
  ["DELETE", /^\/api\/metric-sources\/(\d+)$/, async ({ response, match, service, principal }) => {
    const id = parseId(match[1]);
    const source = await loadSource(service.db, id, principal.tenantId);
    await service.db.query("DELETE FROM metric_source WHERE id = ?", [id]);
    await recordAudit(service.db, { entity: SOURCE_ENTITY, entityId: id, action: "delete", message: `Xóa nguồn "${source.name}"` });
    sendOk(response, { id }, "Đã xóa nguồn số liệu");
  }],
];
