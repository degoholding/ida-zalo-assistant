import { BACKGROUND_TASKS } from "../../schedule/background-tasks.js";
import { listScheduleStatus } from "../../schedule/scheduler.js";
import { parseServiceAccount, parseSpreadsheetId } from "../../google/service-account.js";
import { GoogleSheetsClient, testSheetsConnection } from "../../google/sheets-client.js";
import { GoogleSheetsError } from "../../google/sheets-error-messages.js";
import { findSetting } from "../../settings/setting-registry.js";
import type { SyncService } from "../../sync-service.js";
import { ApiError, readJson, sendOk } from "./api-http.js";
import { currentActorName } from "../../auth/principal.js";
import type { ApiRoute } from "./api-route.js";
import { recordAudit } from "./audit-log.js";

// API màn Cài đặt: xem / lưu / khôi phục cài đặt (phủ lên .env, có hiệu lực ngay) + kiểm tra kết nối
// Google Sheets. KHÔNG log thân PATCH và không bao giờ trả giá trị khóa bí mật (chỉ is_set + hint).

/** Cài đặt là một bản ghi duy nhất — nhật ký thao tác gắn vào entity_id cố định này. */
const SETTINGS_ENTITY_ID = 1;

function labelsOf(keys: string[]): string[] {
  return keys.map((key) => findSetting(key)?.label ?? key);
}

/** Dựng client từ giá trị ĐÃ LƯU; thiếu khóa / link thì 422, không gọi mạng. */
function buildSheetsTarget(service: SyncService): { client: GoogleSheetsClient; spreadsheetId: string } {
  const account = service.settings.getSecret("google_service_account_json");
  if (!account) throw new ApiError(422, "validation_error", "Chưa dán khóa service account");
  const url = service.config.google.spreadsheetUrl;
  if (!url) throw new ApiError(422, "validation_error", "Chưa có link trang tính");
  return { client: new GoogleSheetsClient(parseServiceAccount(account)), spreadsheetId: parseSpreadsheetId(url) };
}

export const settingRoutes: ApiRoute[] = [
  // Việc chạy theo lịch (tiến trình worker) — lần chạy gần nhất, kết quả; đọc bảng schedule_run
  ["GET", /^\/api\/schedules$/, async ({ response, service }) => {
    sendOk(response, await listScheduleStatus(service.db, [...BACKGROUND_TASKS]));
  }],

  ["GET", /^\/api\/settings$/, async ({ response, service }) => {
    sendOk(response, service.settings.describe());
  }],

  ["PATCH", /^\/api\/settings$/, async ({ request, response, service }) => {
    const body = await readJson(request);
    const changed = await service.settings.save(body, currentActorName());
    if (changed.length) {
      service.applySettings(changed);
      // Chỉ ghi nhãn ô đã đổi — khóa bí mật không bao giờ có giá trị cũ / mới trong nhật ký
      await recordAudit(service.db, { entity: "setting", entityId: SETTINGS_ENTITY_ID, action: "update", changedFields: labelsOf(changed) });
    }
    sendOk(response, service.settings.describe(), changed.length ? `Đã lưu ${changed.length} cài đặt` : "Không có gì thay đổi");
  }],

  ["POST", /^\/api\/settings\/google\/test$/, async ({ response, service }) => {
    const { client, spreadsheetId } = buildSheetsTarget(service);
    try {
      const result = await testSheetsConnection(client, spreadsheetId);
      await recordAudit(service.db, {
        entity: "setting", entityId: SETTINGS_ENTITY_ID, action: "test_connection", message: "Kết nối Google Sheets: thành công",
      });
      sendOk(response, result, "Kết nối Google Sheets thành công");
    } catch (error) {
      if (!(error instanceof GoogleSheetsError)) throw error;
      await recordAudit(service.db, {
        entity: "setting", entityId: SETTINGS_ENTITY_ID, action: "test_connection", message: `Kết nối Google Sheets lỗi: ${error.message}`,
      });
      throw new ApiError(422, "google_sheets_error", error.message);
    }
  }],

  ["POST", /^\/api\/settings\/([a-z0-9_]{1,80})\/reset$/, async ({ response, service, match }) => {
    const key = match[1];
    const definition = findSetting(key);
    if (!definition || definition.hidden) throw new ApiError(404, "not_found", `Không có cài đặt ${key}`);
    const existed = await service.settings.reset(key);
    if (existed) {
      service.applySettings([key]);
      await recordAudit(service.db, { entity: "setting", entityId: SETTINGS_ENTITY_ID, action: "reset", changedFields: [definition.label] });
    }
    sendOk(response, service.settings.describe(), existed ? `Đã khôi phục «${definition.label}»` : "Không có gì thay đổi");
  }],
];
