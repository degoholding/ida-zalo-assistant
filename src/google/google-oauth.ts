import crypto from "node:crypto";
import { GoogleSheetsError, NETWORK_ERROR_TEXT } from "./sheets-error-messages.js";

// «Kết nối Google» (06/10/2026): một tài khoản Google thật (Gmail cá nhân cũng được) cho bot quyền tạo sự kiện lịch
// kèm link Meet — service account không tạo được Meet. Luồng OAuth web chuẩn: quản trị bấm Kết nối → Google hỏi đồng
// ý → quay về /api/google/oauth/callback với `code` → đổi lấy refresh token, cất mã hóa trong app_setting.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Tạo / sửa sự kiện lịch (có Meet) — quyền BẮT BUỘC, thiếu thì từ chối kết nối (xem `exchangeAuthCode`). */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
/**
 * Đọc thư mục «Ghi âm họp» trong Drive của CHÍNH Gmail đã kết nối (phase recap họp, 10/10/2026) — quyền TÙY CHỌN:
 * thiếu quyền này Lịch / Meet vẫn chạy bình thường, chỉ tính năng recap tắt (`hasDriveScope`).
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
/** Tạo / sửa sự kiện lịch (có Meet) + đọc Drive (tùy chọn) + biết email tài khoản đã kết nối. */
export const OAUTH_SCOPES = [CALENDAR_SCOPE, DRIVE_SCOPE, "openid", "email"];
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Gmail cá nhân, app ở chế độ Testing: Google thu hồi refresh token sau 7 ngày — câu báo phải nói rõ việc cần làm. */
/** Gặp thật 06/10/2026: màn đồng ý của Google để Ô TICK quyền lịch trống mặc định — bấm Tiếp tục là chỉ cấp email. */
export const MISSING_CALENDAR_SCOPE_TEXT =
  "Google chưa cấp quyền lịch — lúc đăng nhập phải TICK ô «Xem, chỉnh sửa… sự kiện trên lịch». Vào Cài đặt → Google bấm «Kết nối Google» lại và tick ô đó.";
export const RECONNECT_TEXT = "Kết nối Google đã hết hạn hoặc bị thu hồi (app ở chế độ thử nghiệm: 7 ngày phải kết nối lại) — quản trị vào Cài đặt → Google bấm «Kết nối Google».";
/** Đã kết nối nhưng chưa tick quyền Drive lúc đồng ý — recap họp tự động cần kết nối lại. */
export const MISSING_DRIVE_SCOPE_TEXT =
  "Chưa có quyền đọc Google Drive — vào Cài đặt → Google bấm «Kết nối lại Google» và tick thêm ô quyền Drive (chỉ xem tệp) lúc Google hỏi đồng ý.";

export interface OAuthClient {
  client_id: string;
  client_secret: string;
}

export interface GoogleAccountLink {
  email: string;
  refresh_token: string;
  /**
   * Phạm vi Google THỰC SỰ cấp lúc đồng ý (space-separated → mảng). Kết nối từ trước phase recap họp
   * (10/10/2026) không có trường này — coi như chưa có quyền Drive (`hasDriveScope`).
   */
  granted_scopes?: string[];
}

/** Đã kết nối Google VÀ đã tick quyền đọc Drive lúc đồng ý (không chỉ cấu hình Client ID / secret). */
export function hasDriveScope(account: GoogleAccountLink | null | undefined): boolean {
  return Boolean(account?.granted_scopes?.includes(DRIVE_SCOPE));
}

/** OAuth client từ hai ô Cài đặt «Client ID» + «Client secret» (06/10/2026: bỏ dán tệp JSON cho gọn); thiếu ô nào = null. */
export function oauthClientOf(google: { oauthClientId: string; oauthClientSecret: string }): OAuthClient | null {
  return google.oauthClientId && google.oauthClientSecret
    ? { client_id: google.oauthClientId, client_secret: google.oauthClientSecret }
    : null;
}

export function buildAuthUrl(client: OAuthClient, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPES.join(" "),
    // offline + consent: lần nào cũng trả refresh token (không có thì bot không tự chạy được về sau)
    access_type: "offline",
    prompt: "consent",
    state,
    include_granted_scopes: "true",
  });
  return `${AUTH_URL}?${params}`;
}

/** Email trong id_token (JWT của Google, đã qua TLS từ chính Google — chỉ đọc, không cần kiểm chữ ký). */
export function emailFromIdToken(idToken: unknown): string {
  if (typeof idToken !== "string") return "";
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : "";
  } catch {
    return "";
  }
}

async function postToken(body: URLSearchParams, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(TOKEN_URL, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GoogleSheetsError(NETWORK_ERROR_TEXT);
  }
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    if (json.error === "invalid_grant") throw new GoogleSheetsError(RECONNECT_TEXT, response.status);
    if (json.error === "invalid_client") throw new GoogleSheetsError("Google từ chối OAuth client — kiểm tra lại tệp JSON đã dán (client_id / client_secret).", response.status);
    if (json.error === "redirect_uri_mismatch") throw new GoogleSheetsError("Redirect URI chưa khai đúng trong Google Cloud — chép đúng Redirect URI ở màn Cài đặt.", response.status);
    throw new GoogleSheetsError(`Google báo lỗi khi đổi mã đăng nhập (${String(json.error_description ?? json.error ?? response.status)})`, response.status);
  }
  return json;
}

/** Callback: đổi `code` lấy refresh token + email. */
export async function exchangeAuthCode(
  client: OAuthClient, code: string, redirectUri: string, fetcher: typeof fetch = fetch,
): Promise<GoogleAccountLink> {
  const json = await postToken(new URLSearchParams({
    code, client_id: client.client_id, client_secret: client.client_secret, redirect_uri: redirectUri, grant_type: "authorization_code",
  }), fetcher);
  // Người dùng bỏ tick ô quyền lịch → token chỉ có openid/email: đừng lưu kết nối nửa vời rồi báo «đã kết nối»
  const granted = typeof json.scope === "string" ? json.scope.split(" ") : [];
  if (!granted.includes(CALENDAR_SCOPE)) throw new GoogleSheetsError(MISSING_CALENDAR_SCOPE_TEXT);
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : "";
  if (!refreshToken) throw new GoogleSheetsError("Google không trả refresh token — vào myaccount.google.com/permissions gỡ quyền app rồi kết nối lại.");
  // Quyền Drive là TÙY CHỌN — ghi lại đúng những gì Google cấp để `hasDriveScope` biết recap họp bật được chưa
  return { email: emailFromIdToken(json.id_token), refresh_token: refreshToken, granted_scopes: granted };
}

/** Access token từ refresh token, nhớ đệm tới (hết hạn − 60 giây). */
export class GoogleUserAuth {
  private cached: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly client: OAuthClient,
    private readonly account: GoogleAccountLink,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  get email(): string {
    return this.account.email;
  }

  async getAccessToken(): Promise<string> {
    if (this.cached && this.now() < this.cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) return this.cached.value;
    const json = await postToken(new URLSearchParams({
      client_id: this.client.client_id, client_secret: this.client.client_secret,
      refresh_token: this.account.refresh_token, grant_type: "refresh_token",
    }), this.fetcher);
    const token = typeof json.access_token === "string" ? json.access_token : "";
    if (!token) throw new GoogleSheetsError(RECONNECT_TEXT);
    this.cached = { value: token, expiresAt: this.now() + (Number(json.expires_in) || 3600) * 1000 };
    return token;
  }
}

/** `state` chống giả mạo callback: tạo khi quản trị (đã đăng nhập) bấm Kết nối, dùng một lần, sống 10 phút. */
const pendingStates = new Map<string, { redirectUri: string; expiresAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000;

export function createOAuthState(redirectUri: string, now = Date.now()): string {
  for (const [key, entry] of pendingStates) if (entry.expiresAt < now) pendingStates.delete(key);
  const state = crypto.randomBytes(24).toString("base64url");
  pendingStates.set(state, { redirectUri, expiresAt: now + STATE_TTL_MS });
  return state;
}

/** Lấy (và hủy) state; null = không có / hết hạn / đã dùng. */
export function consumeOAuthState(state: string, now = Date.now()): { redirectUri: string } | null {
  const entry = pendingStates.get(state);
  pendingStates.delete(state);
  return entry && entry.expiresAt >= now ? { redirectUri: entry.redirectUri } : null;
}
