import http from "node:http";
import type { RowDataPacket } from "mysql2";
import { createLogger, describeError } from "../logger.js";
import type { SyncService } from "../sync-service.js";
import { handleApiRequest } from "./api/api-router.js";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, SessionStore } from "../auth/session-store.js";
import { QrLoginManager } from "./qr-login.js";
import { serveSpa, SPA_BASE } from "./spa-static.js";
import { pipeStreamToResponse } from "./pipe-stream-to-response.js";
import { createMcpGateway, MCP_PATH } from "../mcp/mcp-http-handler.js";
import { serveLegalPage } from "./legal-pages.js";
import { createMcpOAuthRoutes } from "../mcp/oauth/mcp-oauth-http.js";
import { serveMcpFileLink } from "../mcp/mcp-file-links.js";
import { logMcpCall } from "../mcp/mcp-call-log.js";
import { serveMcpReportLink } from "../mcp/mcp-report-files.js";

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
    if (!name) continue;
    const raw = rest.join("=");
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw; // cookie hỏng (%zz…) — giữ nguyên, không làm sập yêu cầu
    }
  }
  return cookies;
}

function setSecurityHeaders(response: http.ServerResponse): void {
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  // Ảnh QR là data: URL; style inline do Tailwind/Radix sinh lúc chạy. accounts.google.com/gsi: nút «Đăng nhập bằng
  // Google» (Google Identity Services — script, khung chọn tài khoản, kiểu chữ của nút), phase 4
  response.setHeader("Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob: https://*.googleusercontent.com; " +
    "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; script-src 'self' https://accounts.google.com/gsi/client; " +
    "frame-src https://accounts.google.com/gsi/; connect-src 'self' https://accounts.google.com/gsi/; frame-ancestors 'none'");
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
  const sessions = new SessionStore(db);
  const qrLogins = new QrLoginManager(service);
  // Cổng MCP chỉ dựng khi MCP_ENABLED=true; tắt thì /mcp trả 404 như không tồn tại
  const mcpGateway = config.mcp.enabled ? createMcpGateway(db, config, { wakeJobs: () => service.jobs.wake(), storage }) : null;
  // OAuth cho cổng MCP (claude.ai / ChatGPT nối không cần dán khóa) — cùng công tắc MCP_ENABLED
  const mcpOAuth = config.mcp.enabled ? createMcpOAuthRoutes({ db, config, sessions }) : null;
  const cookieFlags = `HttpOnly; SameSite=Strict; Path=/${config.web.cookieSecure ? "; Secure" : ""}`;

  async function handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    setSecurityHeaders(response);
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    const path = url.pathname;
    const forwardedIp = config.web.trustCloudflareIp ? request.headers["cf-connecting-ip"] : undefined;
    const clientKey = String(forwardedIp ?? request.socket.remoteAddress ?? "");

    // /mcp xác thực bằng Bearer riêng, không dùng cookie / luật cùng-nguồn của /api/ — xử lý TRƯỚC mọi nhánh khác
    if (path === MCP_PATH || path === `${MCP_PATH}/`) {
      if (!mcpGateway) throw new HttpError(404, "Không có trang này");
      return mcpGateway.handle(request, response, clientKey);
    }
    // Link tải báo cáo Excel / PDF của công cụ MCP export_report (phase 13.4) — chữ ký + khóa còn sống + quyền không đổi, không theo MCP_FILE_RAW
    if (mcpGateway && await serveMcpReportLink({
      db, secret: config.sessionEncryptionKey, maskPersonalData: config.privacy.maskPersonalData, logCall: (entry) => logMcpCall(db, entry), clientIp: clientKey,
    }, path, url, method, response)) return;
    // Link tải tệp gốc ký sẵn hạn ngắn của công cụ MCP get_file (27/10/2026) — chữ ký thay cho phiên đăng nhập
    if (mcpGateway && config.mcp.fileRaw
      && await serveMcpFileLink({ db, storage, secret: config.sessionEncryptionKey, maskPersonalData: config.privacy.maskPersonalData }, path, url, method, response)) return;
    // Trang công khai cho màn đồng ý OAuth của Google (27/10/2026) — không cần đăng nhập
    if (serveLegalPage(path, method, response)) return;
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    if (mcpOAuth && await mcpOAuth.handle(request, response, path, url, { token, clientKey })) return;

    if (serveSpa(config.web.spaDistDir, path, response)) return;

    if (path.startsWith("/api/")) {
      // Lệnh ghi phải cùng nguồn (lớp hai sau cookie SameSite=Strict)
      if (method !== "GET" && !isSameOrigin(request.headers.origin, request.headers.host)) throw new HttpError(403, "Sai nguồn gửi");
      const handled = await handleApiRequest({ request, response, url }, { service, sessions, qrLogins }, {
        token,
        clientKey,
        setCookie: (value) => value
          ? `${SESSION_COOKIE}=${value}; ${cookieFlags}; Max-Age=${SESSION_MAX_AGE_SECONDS}`
          : `${SESSION_COOKIE}=; ${cookieFlags}; Max-Age=0`,
      });
      if (handled) return;
      throw new HttpError(404, "Không có API này");
    }

    // ---- Ảnh đại diện (đã tải về kho) — cần phiên đăng nhập như mọi dữ liệu khác ----
    const avatarMatch = /^\/avatars\/(c|g)\/([A-Za-z0-9_-]{1,40})$/.exec(path);
    if (avatarMatch && method === "GET") {
      if (!(await sessions.resolve(token))) throw new HttpError(401, "Phiên đăng nhập đã hết");
      const [rows] = await db.query<RowDataPacket[]>(
        avatarMatch[1] === "c" ? "SELECT avatar_key FROM contact WHERE zalo_uid = ?" : "SELECT avatar_key FROM zalo_group WHERE id = ?",
        [avatarMatch[2]]);
      const key = rows[0]?.avatar_key as string | undefined;
      if (!key) throw new HttpError(404, "Chưa có ảnh");
      const stream = await storage.read(key);
      const type = key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";
      await pipeStreamToResponse(stream, response, { "Content-Type": type, "Cache-Control": "private, max-age=3600" });
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

  server.on("close", () => {
    mcpGateway?.close().catch((error) => log.warn(`đóng cổng MCP: ${describeError(error)}`));
  });

  return new Promise((resolve) => {
    server.listen(config.web.port, config.web.host, () => {
      log.info(`giao diện quản trị: http://${config.web.host}:${config.web.port}${SPA_BASE}/`);
      resolve(server);
    });
  });
}
