import http from "node:http";
import type { RowDataPacket } from "mysql2";
import { createLogger, describeError } from "../logger.js";
import type { SyncService } from "../sync-service.js";
import { handleApiRequest } from "./api/api-router.js";
import { AdminAuth, SESSION_COOKIE } from "./auth.js";
import { QrLoginManager } from "./qr-login.js";
import { serveSpa, SPA_BASE } from "./spa-static.js";

// Máy chủ web: giao diện quản trị `web/` (React, khung ERP v2) dưới /app + lớp API JSON /api + ảnh đại diện.
// Giao diện HTML cũ đã gỡ 01/10/2026 — mọi màn nằm trong /app.

const log = createLogger("web");

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name) cookies[name] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

function setSecurityHeaders(response: http.ServerResponse): void {
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  // Ảnh QR là data: URL; style inline do Tailwind/Radix sinh lúc chạy
  response.setHeader("Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
}

function redirect(response: http.ServerResponse, location: string): void {
  response.writeHead(302, { Location: location });
  response.end();
}

// Không có Origin, hoặc "null" (chế độ riêng tư) thì để cookie SameSite=Strict lo; có Origin thật thì phải khớp
function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || origin === "null") return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function startWebServer(service: SyncService): Promise<http.Server> {
  const { db, config, storage } = service;
  const auth = new AdminAuth(config.web.adminPassword);
  const qrLogins = new QrLoginManager(service);
  const cookieFlags = `HttpOnly; SameSite=Strict; Path=/${config.web.cookieSecure ? "; Secure" : ""}`;

  async function handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    setSecurityHeaders(response);
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    const path = url.pathname;
    const forwardedIp = config.web.trustCloudflareIp ? request.headers["cf-connecting-ip"] : undefined;
    const clientKey = String(forwardedIp ?? request.socket.remoteAddress ?? "");
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];

    if (serveSpa(config.web.spaDistDir, path, response)) return;

    if (path.startsWith("/api/")) {
      // Lệnh ghi phải cùng nguồn (lớp hai sau cookie SameSite=Strict)
      if (method !== "GET" && !isSameOrigin(request.headers.origin, request.headers.host)) throw new HttpError(403, "Sai nguồn gửi");
      const handled = await handleApiRequest({ request, response, url }, { service, auth, qrLogins }, {
        token,
        clientKey,
        setCookie: (value) => value
          ? `${SESSION_COOKIE}=${value}; ${cookieFlags}; Max-Age=43200`
          : `${SESSION_COOKIE}=; ${cookieFlags}; Max-Age=0`,
      });
      if (handled) return;
      throw new HttpError(404, "Không có API này");
    }

    // ---- Ảnh đại diện (đã tải về kho) — cần phiên đăng nhập như mọi dữ liệu khác ----
    const avatarMatch = /^\/avatars\/(c|g)\/([A-Za-z0-9_-]{1,40})$/.exec(path);
    if (avatarMatch && method === "GET") {
      if (!auth.isValid(token)) throw new HttpError(401, "Phiên đăng nhập đã hết");
      const [rows] = await db.query<RowDataPacket[]>(
        avatarMatch[1] === "c" ? "SELECT avatar_key FROM contact WHERE zalo_uid = ?" : "SELECT avatar_key FROM zalo_group WHERE id = ?",
        [avatarMatch[2]]);
      const key = rows[0]?.avatar_key as string | undefined;
      if (!key) throw new HttpError(404, "Chưa có ảnh");
      const stream = await storage.read(key);
      const type = key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "private, max-age=3600" });
      stream.pipe(response);
      return;
    }

    // Đường cũ (/, /login, /contacts/12…) → cùng đường trong /app để link đã lưu còn mở được
    if (method === "GET") return redirect(response, path === "/" ? `${SPA_BASE}/` : `${SPA_BASE}${path}${url.search}`);
    throw new HttpError(404, "Không có trang này");
  }

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) log.error(`${request.method} ${request.url} lỗi: ${describeError(error)}`);
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const message = error instanceof HttpError ? error.message : "Lỗi máy chủ — xem log.";
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ success: false, error: { code: status === 404 ? "not_found" : "error", message } }));
    });
  });

  return new Promise((resolve) => {
    server.listen(config.web.port, config.web.host, () => {
      log.info(`giao diện quản trị: http://${config.web.host}:${config.web.port}${SPA_BASE}/`);
      resolve(server);
    });
  });
}
