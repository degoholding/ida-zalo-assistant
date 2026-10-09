import { GoogleTokenError, verifyGoogleIdToken } from "../../auth/google-id-token.js";
import { can, currentPrincipal, loadUserPrincipal, permissionsFor, type Principal } from "../../auth/principal.js";
import type { SessionStore } from "../../auth/session-store.js";
import { createLogger, describeError } from "../../logger.js";
import type { SyncService } from "../../sync-service.js";
import type { QrLoginManager } from "../qr-login.js";
import { accountFriendRoutes } from "./account-friends-api.js";
import { accountRoutes } from "./accounts-api.js";
import { aiKeyRoutes } from "./ai-keys-api.js";
import { ApiError, readJson, sendFail, sendOk } from "./api-http.js";
import type { ApiContext, ApiRoute } from "./api-route.js";
import { auditRoutes, recordAudit } from "./audit-log.js";
import { companyRoutes } from "./companies-api.js";
import { contactRoutes } from "./contacts-api.js";
import { eventRoutes } from "./events-api.js";
import { conversationRoutes } from "./conversations-api.js";
import { fileRoutes } from "./files-api.js";
import { messageSearchRoutes } from "./message-search-api.js";
import { groupRoutes } from "./groups-api.js";
import { importRoutes } from "./imports-api.js";
import { lookupRoutes } from "./lookups-api.js";
import { recipientRoutes } from "./recipients-api.js";
import { ticketRoutes } from "./tickets-api.js";
import { requiredPermission } from "./route-permissions.js";
import { settingRoutes } from "./settings-api.js";
import { assistantChatRoutes } from "./assistant-chat-api.js";
import { OAUTH_CALLBACK_PATH, googleOAuthRoutes, handleOAuthCallback } from "./google-oauth-api.js";
import { userRoutes } from "./users-api.js";

// Lớp API JSON cho giao diện `web/` (khung ERP v2). Mỗi phân hệ một tệp `*-api.ts` khai mảng tuyến;
// ở đây chỉ gom lại, lo đăng nhập / phiên / quyền (phase 4), và đổi lỗi thành phong bì JSON.

const log = createLogger("api");

const routes: ApiRoute[] = [
  ...contactRoutes, ...groupRoutes, ...fileRoutes, ...companyRoutes, ...accountRoutes, ...accountFriendRoutes, ...conversationRoutes, ...lookupRoutes, ...auditRoutes, ...eventRoutes, ...importRoutes, ...settingRoutes, ...aiKeyRoutes, ...assistantChatRoutes, ...googleOAuthRoutes,
  ...userRoutes, ...recipientRoutes, ...ticketRoutes, ...messageSearchRoutes,
];

export interface ApiDeps {
  service: SyncService;
  sessions: SessionStore;
  qrLogins: QrLoginManager;
}

export interface ApiSession {
  token: string | undefined;
  clientKey: string;
  setCookie: (token: string | null) => string;
}

/** Phần trả về cho giao diện sau đăng nhập / ở /api/auth/me — khớp `CurrentUser` của web/. */
function describeUser(principal: Principal) {
  return {
    id: principal.userId ?? 0, full_name: principal.fullName, email: principal.email, role: principal.role,
    all_groups: principal.groupIds === null, permissions: permissionsFor(principal.role),
  };
}

/** Phiên → người đang thao tác. Người dùng đã bị tắt / xóa thì phiên coi như hết. */
async function resolvePrincipal(deps: ApiDeps, token: string | undefined): Promise<Principal | null> {
  const session = await deps.sessions.resolve(token);
  if (!session) return null;
  return loadUserPrincipal(deps.service.db, session.userId);
}

/** Đăng nhập Google: kiểm mã với Google, email phải là người dùng đang bật. */
async function loginWithGoogle(deps: ApiDeps, credential: string): Promise<{ token: string; principal: Principal }> {
  const { db, config } = deps.service;
  let email: string;
  try {
    email = (await verifyGoogleIdToken(credential, config.google.loginClientId)).email;
  } catch (error) {
    if (error instanceof GoogleTokenError) throw new ApiError(401, "google_invalid", error.message);
    throw error;
  }
  const [rows] = await db.query<any[]>("SELECT id, is_active FROM app_user WHERE email = ?", [email]);
  const user = rows[0];
  if (!user) throw new ApiError(403, "not_registered", `Email ${email} chưa được cấp quyền vào Bot trợ lý — nhờ quản trị thêm ở màn Người dùng.`);
  if (!user.is_active) throw new ApiError(403, "user_disabled", "Tài khoản đã bị tắt — liên hệ quản trị.");
  const principal = await loadUserPrincipal(db, Number(user.id));
  if (!principal) throw new ApiError(403, "user_disabled", "Tài khoản đã bị tắt — liên hệ quản trị.");
  await db.query("UPDATE app_user SET last_login_at = NOW(3) WHERE id = ?", [principal.userId]);
  return { token: await deps.sessions.create(Number(principal.userId)), principal };
}

/** Xử lý mọi đường `/api/*`. Trả false nếu không có tuyến (server trả 404 chung). */
export async function handleApiRequest(ctx: Pick<ApiContext, "request" | "response" | "url">, deps: ApiDeps, session: ApiSession): Promise<boolean> {
  const { request, response, url } = ctx;
  const { sessions } = deps;
  const method = request.method ?? "GET";
  const path = url.pathname;
  try {
    // Màn đăng nhập cần biết có nút Google không (chưa đăng nhập nên không qua kiểm phiên)
    if (path === "/api/auth/config" && method === "GET") {
      sendOk(response, { google_client_id: deps.service.config.google.loginClientId || "" });
      return true;
    }
    // Tên đăng nhập (hoặc email) + mật khẩu của từng người — từ 08/10/2026 không còn mật khẩu quản trị chung
    if (path === "/api/auth/login" && method === "POST") {
      const body = await readJson(request);
      const login = typeof body.username === "string" ? body.username.trim().slice(0, 191) : "";
      if (sessions.isLocked(session.clientKey, login)) throw new ApiError(429, "locked", "Sai mật khẩu quá nhiều lần — thử lại sau 15 phút.");
      const userId = await sessions.verifyLogin(session.clientKey, login, typeof body.password === "string" ? body.password : "");
      const principal = userId ? await loadUserPrincipal(deps.service.db, userId) : null;
      if (!principal) {
        log.warn(`đăng nhập sai từ ${session.clientKey}`);
        throw new ApiError(401, "invalid_credentials", "Sai tên đăng nhập hoặc mật khẩu.");
      }
      await deps.service.db.query("UPDATE app_user SET last_login_at = NOW(3) WHERE id = ?", [principal.userId]);
      response.setHeader("Set-Cookie", session.setCookie(await sessions.create(userId!)));
      await currentPrincipal.run(principal, () => recordAudit(deps.service.db, { entity: "user", entityId: userId!, action: "login", message: "Đăng nhập bằng mật khẩu" }));
      sendOk(response, { user: describeUser(principal) }, "Đăng nhập thành công");
      return true;
    }
    if (path === "/api/auth/google" && method === "POST") {
      const body = await readJson(request);
      const { token, principal } = await loginWithGoogle(deps, typeof body.credential === "string" ? body.credential : "");
      response.setHeader("Set-Cookie", session.setCookie(token));
      await currentPrincipal.run(principal, () => recordAudit(deps.service.db, { entity: "user", entityId: principal.userId ?? 0, action: "login", message: "Đăng nhập bằng Google" }));
      log.info(`đăng nhập Google: ${principal.email}`);
      sendOk(response, { user: describeUser(principal) }, "Đăng nhập thành công");
      return true;
    }
    // Google chuyển về sau khi đồng ý: không có cookie phiên (SameSite=Strict) — chống giả mạo bằng `state` một lần
    if (path === OAUTH_CALLBACK_PATH && method === "GET") {
      await handleOAuthCallback(url, response, deps.service);
      return true;
    }

    const route = routes.find(([routeMethod, pattern]) => routeMethod === method && pattern.test(path));
    const isAuthPath = path === "/api/auth/me" || path === "/api/auth/logout";
    if (!route && !isAuthPath) return false;
    const principal = await resolvePrincipal(deps, session.token);
    if (!principal) throw new ApiError(401, "unauthorized", "Phiên đăng nhập đã hết");

    if (path === "/api/auth/me" && method === "GET") {
      sendOk(response, describeUser(principal));
      return true;
    }
    if (path === "/api/auth/logout" && method === "POST") {
      await sessions.logout(session.token);
      response.setHeader("Set-Cookie", session.setCookie(null));
      sendOk(response, null, "Đã đăng xuất");
      return true;
    }
    if (!route) return false;
    const needed = requiredPermission(method, path);
    if (!can(principal, needed.entity, needed.action)) throw new ApiError(403, "forbidden", "Tài khoản của anh/chị không có quyền làm việc này.");
    const [, pattern, handler] = route;
    await currentPrincipal.run(principal, () => handler({
      ...ctx, service: deps.service, qrLogins: deps.qrLogins, sessions, principal, match: pattern.exec(path) as RegExpExecArray,
    }));
    return true;
  } catch (error) {
    if (response.headersSent) {
      // Đang stream (tải tệp) mà hỏng giữa chừng — không gửi JSON đè lên được nữa
      log.error(`${method} ${path} lỗi giữa chừng: ${describeError(error)}`);
      response.destroy();
      return true;
    }
    if (error instanceof ApiError) {
      sendFail(response, error);
    } else {
      log.error(`${method} ${path} lỗi: ${describeError(error)}`);
      sendFail(response, new ApiError(500, "internal_error", "Lỗi máy chủ — xem log."));
    }
    return true;
  }
}
