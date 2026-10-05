import { createLogger, describeError } from "../../logger.js";
import type { SyncService } from "../../sync-service.js";
import type { AdminAuth } from "../auth.js";
import type { QrLoginManager } from "../qr-login.js";
import { accountRoutes } from "./accounts-api.js";
import { ApiError, readJson, sendFail, sendOk } from "./api-http.js";
import { ADMIN_USER, type ApiContext, type ApiRoute } from "./api-route.js";
import { auditRoutes } from "./audit-log.js";
import { companyRoutes } from "./companies-api.js";
import { contactRoutes } from "./contacts-api.js";
import { eventRoutes } from "./events-api.js";
import { conversationRoutes } from "./conversations-api.js";
import { fileRoutes } from "./files-api.js";
import { groupRoutes } from "./groups-api.js";
import { importRoutes } from "./imports-api.js";
import { lookupRoutes } from "./lookups-api.js";
import { buildAdminPermissions } from "./permissions.js";
import { settingRoutes } from "./settings-api.js";

// Lớp API JSON cho giao diện `web/` (khung ERP v2). Mỗi phân hệ một tệp `*-api.ts` khai mảng tuyến;
// ở đây chỉ gom lại, lo đăng nhập / phiên, và đổi lỗi thành phong bì JSON.

const log = createLogger("api");

const routes: ApiRoute[] = [
  ...contactRoutes, ...groupRoutes, ...fileRoutes, ...companyRoutes, ...accountRoutes, ...conversationRoutes, ...lookupRoutes, ...auditRoutes, ...eventRoutes, ...importRoutes, ...settingRoutes,
];

export interface ApiDeps {
  service: SyncService;
  auth: AdminAuth;
  qrLogins: QrLoginManager;
}

export interface ApiSession {
  token: string | undefined;
  clientKey: string;
  setCookie: (token: string | null) => string;
}

/** Xử lý mọi đường `/api/*`. Trả false nếu không có tuyến (server trả 404 chung). */
export async function handleApiRequest(ctx: Omit<ApiContext, "match" | "service" | "qrLogins">, deps: ApiDeps, session: ApiSession): Promise<boolean> {
  const { request, response, url } = ctx;
  const { auth } = deps;
  const method = request.method ?? "GET";
  const path = url.pathname;
  try {
    if (path === "/api/auth/login" && method === "POST") {
      if (auth.isLocked(session.clientKey)) throw new ApiError(429, "locked", "Sai mật khẩu quá nhiều lần — thử lại sau 15 phút.");
      const body = await readJson(request);
      const token = auth.login(session.clientKey, typeof body.password === "string" ? body.password : "");
      if (!token) {
        log.warn(`đăng nhập quản trị sai từ ${session.clientKey}`);
        throw new ApiError(401, "invalid_credentials", "Sai mật khẩu.");
      }
      response.setHeader("Set-Cookie", session.setCookie(token));
      sendOk(response, { user: { ...ADMIN_USER, permissions: buildAdminPermissions() } }, "Đăng nhập thành công");
      return true;
    }
    const route = routes.find(([routeMethod, pattern]) => routeMethod === method && pattern.test(path));
    const isAuthPath = path === "/api/auth/me" || path === "/api/auth/logout";
    if (!route && !isAuthPath) return false;

    if (!auth.isValid(session.token)) throw new ApiError(401, "unauthorized", "Phiên đăng nhập đã hết");
    if (path === "/api/auth/me" && method === "GET") {
      sendOk(response, { ...ADMIN_USER, permissions: buildAdminPermissions() });
      return true;
    }
    if (path === "/api/auth/logout" && method === "POST") {
      auth.logout(session.token);
      response.setHeader("Set-Cookie", session.setCookie(null));
      sendOk(response, null, "Đã đăng xuất");
      return true;
    }
    if (!route) return false;
    const [, pattern, handler] = route;
    await handler({ ...ctx, service: deps.service, qrLogins: deps.qrLogins, match: pattern.exec(path) as RegExpExecArray });
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
