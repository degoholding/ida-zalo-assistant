import type http from "node:http";
import {
  buildAuthUrl,
  clearGoogleRefreshFailure,
  consumeOAuthState,
  createOAuthState,
  exchangeAuthCode,
  getGoogleRefreshFailure,
  assessGoogleLink,
  hasDriveScope,
  oauthClientOf,
} from "../../google/google-oauth.js";
import type { RowDataPacket } from "mysql2";
import { GoogleSheetsError } from "../../google/sheets-error-messages.js";
import { createLogger, describeError } from "../../logger.js";
import type { SyncService } from "../../sync-service.js";
import { ApiError, sendOk } from "./api-http.js";
import { currentActorName } from "../../auth/principal.js";
import type { ApiRoute } from "./api-route.js";
import { recordAudit } from "./audit-log.js";

// "Kết nối Google" trên màn Cài đặt (06/10/2026): trạng thái, bắt đầu, ngắt, và callback Google gọi về sau khi quản
// trị đồng ý. Callback KHÔNG có cookie phiên (Google chuyển trang từ tên miền khác, cookie SameSite=Strict không đi
// kèm) — chống giả mạo bằng `state` dùng một lần, chỉ tạo được khi quản trị đã đăng nhập bấm "Kết nối Google".

const log = createLogger("google-oauth");
export const OAUTH_CALLBACK_PATH = "/api/google/oauth/callback";
const ACCOUNT_KEY = "google_calendar_account";
const SETTINGS_ENTITY_ID = 1;
const SETTINGS_PAGE = "/app/settings?tab=google";

/** Redirect URI theo đúng địa chỉ quản trị đang mở (Google chỉ nhận http với localhost). */
export function redirectUriFor(request: http.IncomingMessage): string {
  const forwarded = String(request.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const proto = forwarded === "https" ? "https" : "http";
  return `${proto}://${request.headers.host ?? "localhost:8090"}${OAUTH_CALLBACK_PATH}`;
}

/** Lúc kết nối: trường `connected_at` (từ 27/10/2026); kết nối cũ hơn thì lấy dòng «Kết nối Google» mới nhất trong Lịch sử thao tác. */
async function connectedAtOf(service: SyncService): Promise<string | null> {
  const account = service.config.google.calendarAccount;
  if (!account) return null;
  if (account.connected_at) return account.connected_at;
  try {
    const [rows] = await service.db.query<RowDataPacket[]>(
      "SELECT created_at FROM audit_log WHERE entity = 'setting' AND action = 'google_connect' ORDER BY id DESC LIMIT 1");
    const at = rows[0]?.created_at as Date | string | undefined;
    return at ? new Date(at).toISOString() : null;
  } catch {
    return null;
  }
}

/**
 * Trạng thái kết nối + HẠN (27/10/2026, cho chấm trạng thái trên menu): app Google ở chế độ Testing nên 7 ngày hết hạn;
 * `health`: ok / expiring (còn dưới 1 ngày) / expired (quá hạn theo ngày HOẶC Google vừa từ chối refresh token) / disconnected.
 */
async function status(service: SyncService, request: http.IncomingMessage) {
  const { calendarAccount } = service.config.google;
  // App In production (GOOGLE_OAUTH_TESTING=false): không tính hạn 7 ngày, khỏi tra nhật ký
  const testing = service.config.google.oauthTesting !== false;
  const connectedAt = testing ? await connectedAtOf(service) : calendarAccount?.connected_at ?? null;
  const refreshFailure = calendarAccount ? getGoogleRefreshFailure() : null;
  const link = assessGoogleLink({ connected: Boolean(calendarAccount), connectedAt, testing, refused: Boolean(refreshFailure) });
  return {
    client_configured: Boolean(oauthClientOf(service.config.google)),
    connected: Boolean(calendarAccount),
    email: calendarAccount?.email ?? "",
    redirect_uri: redirectUriFor(request),
    // Recap họp tự động (phase 1, 10/10/2026) cần quyền Drive — tùy chọn, kết nối Lịch vẫn chạy được khi thiếu
    drive_scope_granted: hasDriveScope(calendarAccount),
    oauth_testing: testing,
    connected_at: connectedAt,
    expires_at: link.expires_at,
    days_left: link.days_left === null ? null : Math.round(link.days_left * 10) / 10,
    expired: link.expired,
    refresh_error: refreshFailure?.message ?? "",
    refresh_error_at: refreshFailure?.at ?? null,
    health: link.health,
  };
}

export const googleOAuthRoutes: ApiRoute[] = [
  ["GET", /^\/api\/google\/oauth\/status$/, async ({ request, response, service }) => {
    sendOk(response, await status(service, request));
  }],

  ["POST", /^\/api\/google\/oauth\/start$/, async ({ request, response, service }) => {
    const client = oauthClientOf(service.config.google);
    if (!client) throw new ApiError(409, "oauth_client_missing", "Chưa có Client ID / Client secret — chép hai dòng đó từ Google Cloud vào ô 'Kết nối Google' rồi Lưu trước");
    const redirectUri = redirectUriFor(request);
    sendOk(response, { auth_url: buildAuthUrl(client, redirectUri, createOAuthState(redirectUri)) });
  }],

  ["POST", /^\/api\/google\/oauth\/disconnect$/, async ({ request, response, service }) => {
    const existed = await service.settings.reset(ACCOUNT_KEY);
    clearGoogleRefreshFailure();
    if (existed) await recordAudit(service.db, { entity: "setting", entityId: SETTINGS_ENTITY_ID, action: "google_disconnect", message: "Ngắt kết nối Google" });
    sendOk(response, await status(service, request), "Đã ngắt kết nối Google");
  }],
];

function redirectToSettings(response: http.ServerResponse, outcome: "connected" | "error", message = ""): void {
  const query = new URLSearchParams({ google_oauth: outcome, ...(message ? { message } : {}) });
  response.writeHead(302, { Location: `${SETTINGS_PAGE}&${query}`, "Cache-Control": "no-store" });
  response.end();
}

/** Google gọi về sau khi quản trị đồng ý / từ chối. Xử lý TRƯỚC bước kiểm phiên đăng nhập (xem api-router). */
export async function handleOAuthCallback(url: URL, response: http.ServerResponse, service: SyncService): Promise<void> {
  const state = consumeOAuthState(url.searchParams.get("state") ?? "");
  if (!state) return redirectToSettings(response, "error", "Phiên kết nối Google đã hết hạn hoặc không hợp lệ — bấm 'Kết nối Google' lại.");
  if (url.searchParams.get("error")) {
    return redirectToSettings(response, "error", url.searchParams.get("error") === "access_denied" ? "Anh/chị đã từ chối cấp quyền cho bot." : `Google báo lỗi: ${url.searchParams.get("error")}`);
  }
  const client = oauthClientOf(service.config.google);
  const code = url.searchParams.get("code") ?? "";
  if (!client || !code) return redirectToSettings(response, "error", "Thiếu OAuth client hoặc mã đăng nhập — thử lại.");
  try {
    const account = { ...(await exchangeAuthCode(client, code, state.redirectUri)), connected_at: new Date().toISOString() };
    await service.settings.saveInternal(ACCOUNT_KEY, account as unknown as Record<string, unknown>, currentActorName());
    clearGoogleRefreshFailure();
    await recordAudit(service.db, { entity: "setting", entityId: SETTINGS_ENTITY_ID, action: "google_connect", message: `Kết nối Google: ${account.email || "(không rõ email)"}` });
    log.info(`đã kết nối Google ${account.email}`);
    redirectToSettings(response, "connected");
  } catch (error) {
    const message = error instanceof GoogleSheetsError ? error.message : `Không kết nối được Google: ${describeError(error)}`;
    log.warn(`kết nối Google lỗi: ${message}`);
    redirectToSettings(response, "error", message);
  }
}
