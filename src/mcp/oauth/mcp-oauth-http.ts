import type http from "node:http";
import type { AppConfig } from "../../config.js";
import { McpAccessLevel } from "../../constants.js";
import type { Db } from "../../db/pool.js";
import { loadUserPrincipal } from "../../auth/principal.js";
import type { SessionStore } from "../../auth/session-store.js";
import { createLogger, describeError } from "../../logger.js";
import { FailureWindow } from "../mcp-rate-limiter.js";
import { renderConsentPage, renderOAuthErrorPage } from "./mcp-oauth-pages.js";
import {
  approveRequest, authenticateClient, authorizationServerMetadata, beginAuthorize, denyRequest, describeRequest, exchangeCode,
  OAuthError, protectedResourceMetadata, refreshTokens, registerClient, resolveIssuer, revokeToken,
} from "./mcp-oauth.js";

// Đường HTTP của máy chủ cấp quyền OAuth cho cổng /mcp (27/10/2026). Lõi ở mcp-oauth.ts. Chỉ dựng khi MCP_ENABLED.
//   Công khai (ứng dụng AI gọi): /.well-known/oauth-authorization-server[/…], /.well-known/oauth-protected-resource[/…],
//   POST /oauth/register, GET /oauth/authorize (trình duyệt mở → 302 sang màn đồng ý), POST /oauth/token, POST /oauth/revoke.
//   Màn đồng ý: GET /oauth/consent?req=… (HTML, không cần phiên) + POST /oauth/consent (CẦN phiên web: cookie SameSite=Strict
//   chỉ đi theo yêu cầu cùng trang, nên form POST từ chính trang đồng ý mang được cookie, còn cú chuyển từ claude.ai thì không).

const log = createLogger("mcp-oauth");
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };
/** Ứng dụng thật đăng ký một lần mỗi lần nối — 5 lượt / phút / IP là dư. */
const REGISTER_PER_MINUTE_PER_IP = 5;
const MAX_FORM_BYTES = 16 * 1024;
const CORS_PATHS = new Set(["/oauth/register", "/oauth/token", "/oauth/revoke"]);

export interface McpOAuthDeps {
  db: Db;
  config: AppConfig;
  sessions: SessionStore;
  /** Trần đăng ký ứng dụng mỗi phút mỗi IP (mặc định REGISTER_PER_MINUTE_PER_IP; bài kiểm nới ra). */
  registerPerMinute?: number;
}

export interface McpOAuthRoutes {
  /** true = đường này của OAuth và đã trả lời. */
  handle(request: http.IncomingMessage, response: http.ServerResponse, path: string, url: URL, ctx: { token: string | undefined; clientKey: string }): Promise<boolean>;
}

function sendJson(response: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...headers });
  response.end(JSON.stringify(body));
}

function sendHtml(response: http.ServerResponse, status: number, html: string): void {
  // Màn đồng ý không được nhúng khung (chống clickjacking lừa bấm Cho phép) — đặt ở đây cho chắc, không trông vào máy chủ chung
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8", ...NO_STORE, "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  });
  response.end(html);
}

function redirect(response: http.ServerResponse, location: string): void {
  response.writeHead(302, { Location: location, ...NO_STORE });
  response.end();
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_FORM_BYTES) throw new OAuthError("invalid_request", "Thân yêu cầu quá lớn.", 413);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Form (application/x-www-form-urlencoded) hoặc JSON → bảng chuỗi. */
export async function readForm(request: http.IncomingMessage): Promise<Record<string, string>> {
  const raw = await readBody(request);
  if ((request.headers["content-type"] ?? "").includes("application/json")) {
    try {
      const value: unknown = JSON.parse(raw || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item ?? "")]));
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

/** client_secret_basic (header Basic, RFC 6749 §2.3.1 — hai phần đã url-encode) hoặc trong form. */
export function clientCredentials(request: http.IncomingMessage, form: Record<string, string>): { clientId: string; secret: string } {
  const header = request.headers.authorization ?? "";
  if (/^basic /i.test(header)) {
    try {
      const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon < 0) return { clientId: "", secret: "" };
      return { clientId: decodeURIComponent(decoded.slice(0, colon)), secret: decodeURIComponent(decoded.slice(colon + 1)) };
    } catch {
      return { clientId: "", secret: "" };
    }
  }
  return { clientId: form.client_id ?? "", secret: form.client_secret ?? "" };
}

function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || origin === "null") return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function createMcpOAuthRoutes(deps: McpOAuthDeps): McpOAuthRoutes {
  const { db, config, sessions } = deps;
  const secret = config.sessionEncryptionKey;
  const registrations = new FailureWindow(deps.registerPerMinute ?? REGISTER_PER_MINUTE_PER_IP);
  if (!config.mcp.publicUrl) log.warn("MCP_PUBLIC_URL chưa khai: OAuth cổng MCP (claude.ai / ChatGPT) trả 503 trừ khi gọi từ máy local.");

  const issuerOf = (request: http.IncomingMessage) => resolveIssuer(config.mcp.publicUrl, request.headers.host);

  async function consentPost(request: http.IncomingMessage, response: http.ServerResponse, token: string | undefined): Promise<void> {
    if (!isSameOrigin(request.headers.origin, request.headers.host)) throw new OAuthError("invalid_request", "Sai nguồn gửi.", 403);
    const form = await readForm(request);
    const base = issuerOf(request);
    const requestToken = form.req ?? "";
    if (form.decision === "deny") return redirect(response, denyRequest(requestToken, base, secret));
    const view = await describeRequest(db, requestToken, secret);
    const session = await sessions.resolve(token);
    const principal = session ? await loadUserPrincipal(db, session.userId) : null;
    if (!principal) {
      return sendHtml(response, 401, renderConsentPage({ view, requestToken, notice: "login" }));
    }
    const level = form.level === String(McpAccessLevel.ReadWrite) ? McpAccessLevel.ReadWrite : McpAccessLevel.Read;
    try {
      const location = await approveRequest(db, principal, requestToken, { level, includeConfidential: form.confidential === "1" }, base, secret);
      log.info(`người dùng #${principal.userId} cấp quyền MCP cho «${view.clientName}»`);
      return redirect(response, location);
    } catch (error) {
      if (error instanceof OAuthError && error.error === "access_denied") {
        return sendHtml(response, 403, renderConsentPage({ view, requestToken, notice: "role", userName: principal.fullName }));
      }
      throw error;
    }
  }

  async function route(request: http.IncomingMessage, response: http.ServerResponse, path: string, url: URL, ctx: { token: string | undefined; clientKey: string }): Promise<boolean> {
    const method = request.method ?? "GET";
    if (CORS_PATHS.has(path) || path.startsWith("/.well-known/oauth-")) {
      response.setHeader("Access-Control-Allow-Origin", "*");
      if (method === "OPTIONS") {
        response.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Max-Age": "86400" });
        response.end();
        return true;
      }
    }
    if (method === "GET" && /^\/\.well-known\/oauth-authorization-server(\/.*)?$/.test(path)) {
      sendJson(response, 200, authorizationServerMetadata(issuerOf(request)), { "Cache-Control": "public, max-age=300" });
      return true;
    }
    if (method === "GET" && /^\/\.well-known\/oauth-protected-resource(\/.*)?$/.test(path)) {
      sendJson(response, 200, protectedResourceMetadata(issuerOf(request)), { "Cache-Control": "public, max-age=300" });
      return true;
    }
    if (path === "/oauth/register" && method === "POST") {
      if (registrations.isBlocked(ctx.clientKey)) {
        sendJson(response, 429, { error: "invalid_client_metadata", error_description: "Đăng ký quá dồn dập, thử lại sau." });
        return true;
      }
      registrations.recordFailure(ctx.clientKey);
      let payload: unknown;
      try {
        payload = JSON.parse((await readBody(request)) || "{}");
      } catch {
        throw new OAuthError("invalid_client_metadata", "Thân yêu cầu không phải JSON.");
      }
      sendJson(response, 201, await registerClient(db, payload, ctx.clientKey));
      return true;
    }
    if (path === "/oauth/authorize" && method === "GET") {
      const base = issuerOf(request);
      let outcome;
      try {
        outcome = await beginAuthorize(db, url.searchParams, base, secret);
      } catch (error) {
        if (error instanceof OAuthError) {
          sendHtml(response, 400, renderOAuthErrorPage(error.description));
          return true;
        }
        throw error;
      }
      redirect(response, outcome.kind === "redirect" ? outcome.url : `${base}/oauth/consent?req=${encodeURIComponent(outcome.request)}`);
      return true;
    }
    if (path === "/oauth/consent" && method === "GET") {
      const requestToken = url.searchParams.get("req") ?? "";
      try {
        sendHtml(response, 200, renderConsentPage({ view: await describeRequest(db, requestToken, secret), requestToken }));
      } catch (error) {
        if (!(error instanceof OAuthError)) throw error;
        sendHtml(response, 400, renderOAuthErrorPage(error.description));
      }
      return true;
    }
    if (path === "/oauth/consent" && method === "POST") {
      try {
        await consentPost(request, response, ctx.token);
      } catch (error) {
        if (!(error instanceof OAuthError)) throw error;
        sendHtml(response, error.status >= 400 && error.status < 600 ? error.status : 400, renderOAuthErrorPage(error.description));
      }
      return true;
    }
    if (path === "/oauth/token" && method === "POST") {
      const form = await readForm(request);
      const credentials = clientCredentials(request, form);
      const client = await authenticateClient(db, credentials.clientId, credentials.secret);
      const grant = form.grant_type ?? "";
      if (grant === "authorization_code") {
        sendJson(response, 200, await exchangeCode(db, client, { code: form.code ?? "", redirectUri: form.redirect_uri ?? "", verifier: form.code_verifier ?? "", resource: form.resource ?? "" }));
      } else if (grant === "refresh_token") {
        sendJson(response, 200, await refreshTokens(db, client, form.refresh_token ?? ""));
      } else {
        throw new OAuthError("unsupported_grant_type", "Chỉ nhận authorization_code / refresh_token.");
      }
      return true;
    }
    if (path === "/oauth/revoke" && method === "POST") {
      const form = await readForm(request);
      const credentials = clientCredentials(request, form);
      await revokeToken(db, await authenticateClient(db, credentials.clientId, credentials.secret), form.token ?? "");
      sendJson(response, 200, {});
      return true;
    }
    return false;
  }

  return {
    async handle(request, response, path, url, ctx) {
      if (!path.startsWith("/oauth/") && !path.startsWith("/.well-known/oauth-")) return false;
      try {
        return await route(request, response, path, url, ctx);
      } catch (error) {
        if (error instanceof OAuthError) {
          sendJson(response, error.status, error.body());
          return true;
        }
        log.error(`${request.method} ${path} lỗi: ${describeError(error)}`);
        sendJson(response, 500, { error: "server_error", error_description: "Lỗi máy chủ — xem log." });
        return true;
      }
    },
  };
}
