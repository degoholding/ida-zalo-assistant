import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { generateMcpKey, parseMcpKey } from "../../auth/mcp-api-key-format.js";
import { canUseMcp, maxAccessLevelForRole } from "../../auth/mcp-api-key-store.js";
import { canSeeConfidential, type Principal } from "../../auth/principal.js";
import { McpAccessLevel, McpKeyKind } from "../../constants.js";
import type { Db } from "../../db/pool.js";

// Máy chủ cấp quyền OAuth 2.1 TỐI THIỂU cho cổng /mcp (27/10/2026, chép thiết kế cổng MCP của ERP ai-CR-218..225, bao-CR-625).
// claude.ai / ChatGPT / Claude Desktop (Connectors) không dán được khóa vào header — chúng nối MCP theo đặc tả MCP 2025-06-18:
// đọc /.well-known/oauth-protected-resource (RFC 9728) → /.well-known/oauth-authorization-server (RFC 8414) → tự đăng ký
// (RFC 7591) → mở màn đồng ý trên web bot → đổi mã lấy token (PKCE S256 bắt buộc) → gọi /mcp với Bearer <mã truy cập>.
//
// - Mỗi lần người dùng bấm «Cho phép» = MỘT dòng mcp_api_key kind = OAuth: cùng mức đọc / đọc+ghi, cùng nhật ký mcp_call_log,
//   cùng màn «Khóa MCP», thu hồi là cắt ngay. token_hash = băm mã truy cập hiện hành (hạn ACCESS_TTL_SECONDS),
//   refresh_hash = băm mã làm mới (xoay vòng mỗi lần đổi), expires_at = hạn cả kết nối (GRANT_DAYS). Cấp lại cho cùng
//   (người, ứng dụng) thì kết nối cũ bị thu hồi.
// - Mã truy cập cùng định dạng khóa dán tay (idamcp_…) nên cổng /mcp kiểm chung một đường (verifyMcpKey).
// - Mã cấp quyền (code) chỉ giữ băm, sống CODE_TTL_SECONDS, dùng MỘT lần (đốt trước mọi kiểm tra).
// - Tham số /authorize đi tới màn đồng ý dưới dạng chuỗi KÝ HMAC (khóa SESSION_ENCRYPTION_KEY), không lưu DB.
// - Chỉ Quản trị / Quản lý được cấp quyền (canUseMcp).

export const ACCESS_TTL_SECONDS = 3600;
export const CODE_TTL_SECONDS = 300;
export const REQUEST_TTL_SECONDS = 600;
export const GRANT_DAYS = 90;
export const REFRESH_PREFIX = "idamcr_";
export const CLIENT_PREFIX = "idaoc_";
export const SCOPE_READ = "mcp:read";
export const SCOPE_WRITE = "mcp:write";
const MAX_REDIRECT_URIS = 10;
const URI_MAX_LENGTH = 500;
const NAME_MAX_LENGTH = 200;
/** Trần đăng ký ứng dụng: mỗi IP / ngày (ứng dụng thật đăng ký một lần mỗi lần nối) + toàn hệ / ngày (lưới cuối). Review 27/10:
 *  chỉ có trần toàn hệ thì một IP dồn 5 lượt / phút khóa được việc nối của cả hệ. */
export const REGISTER_PER_IP_PER_DAY = 20;
const REGISTER_PER_DAY = 1000;
const CODE_KEEP_DAYS = 1;
export const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;
export const GRANT_TYPES = ["authorization_code", "refresh_token"] as const;
const BAD_SCHEMES = new Set(["javascript", "data", "file", "vbscript", "about", "blob"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
/** Địa chỉ quay về của các ứng dụng AI quen — khác thì màn đồng ý cảnh báo đỏ (chống lừa cấp quyền). So theo HOSTNAME. */
const KNOWN_REDIRECT_HOSTS = ["chatgpt.com", "openai.com", "claude.ai", "anthropic.com", "claude.com"];
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

/** Lỗi theo RFC 6749 §5.2 / RFC 7591 §3.2.2. */
export class OAuthError extends Error {
  constructor(readonly error: string, readonly description: string, readonly status = 400) {
    super(description);
    this.name = "OAuthError";
  }
  body(): { error: string; error_description: string } {
    return { error: this.error, error_description: this.description };
  }
}

const sha256 = (text: string): string => crypto.createHash("sha256").update(text).digest("hex");
const hashSecret = (raw: string): string => sha256(`mcp-oauth:${raw}`);
const randomToken = (bytes: number): string => crypto.randomBytes(bytes).toString("base64url");

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// ---- địa chỉ -------------------------------------------------------------------------------------------------------

/**
 * Gốc công khai của cổng — CHỈ lấy cấu hình MCP_PUBLIC_URL (vd https://botida.degoholding.vn). Không đọc X-Forwarded-Host:
 * người gọi tự đặt được header đó. Chưa khai thì chỉ máy local (Host loopback) dùng tạm địa chỉ đang đến; còn lại 503.
 */
export function resolveIssuer(publicUrl: string, host: string | undefined): string {
  if (publicUrl) return publicUrl.replace(/\/+$/, "");
  let hostname = "";
  try {
    hostname = host ? new URL(`http://${host}`).hostname.toLowerCase() : "";
  } catch {
    hostname = "";
  }
  if (host && LOOPBACK_HOSTS.has(hostname)) return `http://${host}`;
  throw new OAuthError("server_error", "Máy chủ chưa khai MCP_PUBLIC_URL (gốc công khai của bot) nên chưa nối OAuth được — báo quản trị.", 503);
}

export const resourceUrl = (base: string): string => `${base}/mcp`;
export const protectedResourceMetadataUrl = (base: string): string => `${base}/.well-known/oauth-protected-resource`;

export function authorizationServerMetadata(base: string): Record<string, unknown> {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: [...GRANT_TYPES],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [...AUTH_METHODS],
    revocation_endpoint_auth_methods_supported: [...AUTH_METHODS],
    scopes_supported: [SCOPE_READ, SCOPE_WRITE],
    authorization_response_iss_parameter_supported: true,
  };
}

export function protectedResourceMetadata(base: string): Record<string, unknown> {
  return {
    resource: resourceUrl(base),
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: [SCOPE_READ, SCOPE_WRITE],
    resource_name: "Bot trợ lý",
  };
}

// ---- đăng ký ứng dụng (RFC 7591) -----------------------------------------------------------------------------------

/** https có máy chủ; http CHỈ cho máy cục bộ (RFC 8252); lược đồ riêng của ứng dụng cài máy (cursor://…) được. Không #, không userinfo. */
export function isValidRedirectUri(uri: unknown): boolean {
  if (typeof uri !== "string" || !uri || uri.length > URI_MAX_LENGTH || uri.includes("#")) return false;
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (!scheme || BAD_SCHEMES.has(scheme)) return false;
  if (parsed.username || parsed.password) return false;
  if (scheme === "https") return Boolean(parsed.hostname);
  if (scheme === "http") return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  return true;
}

export interface OAuthClientRow {
  id: number;
  clientId: string;
  clientName: string;
  redirectUris: string[];
  authMethod: string;
  secretHash: string | null;
}

function toClient(row: RowDataPacket): OAuthClientRow {
  const uris = typeof row.redirect_uris === "string" ? JSON.parse(row.redirect_uris) : row.redirect_uris;
  return {
    id: Number(row.id), clientId: String(row.client_id), clientName: String(row.client_name),
    redirectUris: Array.isArray(uris) ? uris.map(String) : [], authMethod: String(row.token_endpoint_auth_method),
    secretHash: row.client_secret_hash ? String(row.client_secret_hash) : null,
  };
}

export async function registerClient(db: Db, payload: unknown, ip: string): Promise<Record<string, unknown>> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new OAuthError("invalid_client_metadata", "Thân yêu cầu phải là đối tượng JSON.");
  const body = payload as Record<string, unknown>;
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > MAX_REDIRECT_URIS) {
    throw new OAuthError("invalid_redirect_uri", `Cần 1 tới ${MAX_REDIRECT_URIS} redirect_uris.`);
  }
  const bad = uris.filter((uri) => !isValidRedirectUri(uri));
  if (bad.length) {
    throw new OAuthError("invalid_redirect_uri",
      `redirect_uri không hợp lệ (https, http cục bộ, hoặc lược đồ riêng; không có #): ${bad.slice(0, 3).map((uri) => String(uri).slice(0, 80)).join(", ")}`);
  }
  const method = String(body.token_endpoint_auth_method ?? "none");
  if (!(AUTH_METHODS as readonly string[]).includes(method)) throw new OAuthError("invalid_client_metadata", `token_endpoint_auth_method chỉ nhận: ${AUTH_METHODS.join(", ")}.`);
  const grants = body.grant_types ?? [...GRANT_TYPES];
  if (!Array.isArray(grants) || !grants.every((grant) => (GRANT_TYPES as readonly string[]).includes(String(grant))) || !grants.includes("authorization_code")) {
    throw new OAuthError("invalid_client_metadata", "grant_types chỉ nhận authorization_code (+ refresh_token).");
  }
  const responses = body.response_types ?? ["code"];
  if (!Array.isArray(responses) || responses.length !== 1 || responses[0] !== "code") throw new OAuthError("invalid_client_metadata", "response_types chỉ nhận [\"code\"].");

  // Dọn mã cấp quyền đã hết hạn quá 1 ngày (đăng ký là lúc hiếm, đủ để bảng không phình)
  await db.query(`DELETE FROM mcp_oauth_code WHERE expires_at < NOW(3) - INTERVAL ${CODE_KEEP_DAYS} DAY`);
  const [count] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total, SUM(ip = ?) AS from_ip FROM mcp_oauth_client WHERE created_at >= NOW(3) - INTERVAL 1 DAY", [ip.slice(0, 64)]);
  if (Number(count[0]?.from_ip ?? 0) >= REGISTER_PER_IP_PER_DAY) throw new OAuthError("temporarily_unavailable", "Máy này đăng ký quá nhiều ứng dụng hôm nay — thử lại ngày mai.", 429);
  if (Number(count[0]?.total) >= REGISTER_PER_DAY) throw new OAuthError("temporarily_unavailable", "Hôm nay đã quá nhiều ứng dụng đăng ký — thử lại sau.", 429);

  const name = String(body.client_name ?? "").trim().slice(0, NAME_MAX_LENGTH) || "Ứng dụng AI";
  const clientId = CLIENT_PREFIX + randomToken(24);
  const secret = method === "none" ? "" : randomToken(32);
  await db.query(
    `INSERT INTO mcp_oauth_client (client_id, client_name, redirect_uris, token_endpoint_auth_method, client_secret_hash, ip)
     VALUES (?, ?, ?, ?, ?, ?)`, [clientId, name, JSON.stringify(uris), method, secret ? hashSecret(secret) : null, ip.slice(0, 64)]);
  return {
    client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: uris,
    grant_types: grants, response_types: ["code"], token_endpoint_auth_method: method,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
  };
}

export async function findClient(db: Db, clientId: string): Promise<OAuthClientRow | null> {
  if (!clientId || !clientId.startsWith(CLIENT_PREFIX)) return null;
  const [rows] = await db.query<RowDataPacket[]>("SELECT * FROM mcp_oauth_client WHERE client_id = ?", [clientId.slice(0, 64)]);
  return rows[0] ? toClient(rows[0]) : null;
}

/** Xác thực ứng dụng ở đường token / revoke. Ứng dụng công khai (`none`) chỉ cần client_id (đã có PKCE). */
export async function authenticateClient(db: Db, clientId: string, secret: string): Promise<OAuthClientRow> {
  const client = await findClient(db, clientId);
  if (!client) throw new OAuthError("invalid_client", "Ứng dụng chưa đăng ký.", 401);
  if (client.authMethod !== "none" && (!secret || !safeEqual(hashSecret(secret), client.secretHash ?? ""))) {
    throw new OAuthError("invalid_client", "Sai bí mật ứng dụng.", 401);
  }
  return client;
}

// ---- yêu cầu cấp quyền (/authorize → màn đồng ý) -------------------------------------------------------------------

export interface SignedRequest {
  /** client_id */
  c: string;
  /** redirect_uri */
  r: string;
  /** state */
  s: string;
  /** code_challenge */
  pc: string;
  /** resource */
  rs: string;
  /** mức xin: 1 đọc · 2 đọc + ghi */
  w: number;
  exp: number;
}

const sign = (payload: string, secret: string): string =>
  crypto.createHmac("sha256", secret).update(`mcp-oauth-req:${payload}`).digest("hex").slice(0, 32);

export function signRequest(data: Omit<SignedRequest, "exp">, secret: string, nowMs = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(nowMs / 1000) + REQUEST_TTL_SECONDS })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readRequest(token: string, secret: string, nowMs = Date.now()): SignedRequest | null {
  const dot = String(token ?? "").lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  if (!safeEqual(sign(payload, secret), token.slice(dot + 1))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SignedRequest;
    if (!data || typeof data !== "object" || typeof data.exp !== "number" || data.exp * 1000 < nowMs) return null;
    if (typeof data.c !== "string" || typeof data.r !== "string" || typeof data.pc !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

export function redirectWith(uri: string, params: Record<string, string | undefined | null>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  return url.toString();
}

export type AuthorizeOutcome = { kind: "consent"; request: string } | { kind: "redirect"; url: string };

/**
 * Kiểm tham số /authorize. Ứng dụng lạ / redirect_uri lạ → OAuthError (KHÔNG chuyển hướng tới địa chỉ chưa kiểm — RFC 6749
 * §4.1.2.1). Lỗi khác trả được về ứng dụng → { kind: "redirect" }.
 */
export async function beginAuthorize(db: Db, params: URLSearchParams, base: string, secret: string): Promise<AuthorizeOutcome> {
  const client = await findClient(db, params.get("client_id") ?? "");
  if (!client) throw new OAuthError("invalid_client", "Ứng dụng chưa đăng ký với bot (client_id lạ).");
  let redirectUri = params.get("redirect_uri") ?? "";
  if (!redirectUri && client.redirectUris.length === 1) redirectUri = client.redirectUris[0];
  if (!client.redirectUris.includes(redirectUri)) throw new OAuthError("invalid_request", "redirect_uri không khớp địa chỉ ứng dụng đã đăng ký.");
  const state = (params.get("state") ?? "").slice(0, 1000);
  const fail = (error: string, description: string): AuthorizeOutcome =>
    ({ kind: "redirect", url: redirectWith(redirectUri, { error, error_description: description, state, iss: base }) });

  if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Chỉ hỗ trợ response_type=code.");
  const challenge = params.get("code_challenge") ?? "";
  if (!challenge || params.get("code_challenge_method") !== "S256" || challenge.length < 43 || challenge.length > 128) {
    return fail("invalid_request", "Bắt buộc PKCE: code_challenge + code_challenge_method=S256.");
  }
  const resource = (params.get("resource") ?? "").slice(0, URI_MAX_LENGTH);
  if (resource && resource.replace(/\/+$/, "") !== resourceUrl(base)) return fail("invalid_target", "resource không phải cổng /mcp của bot này.");
  const wantWrite = (params.get("scope") ?? "").split(/\s+/).includes(SCOPE_WRITE);
  return {
    kind: "consent",
    request: signRequest({ c: client.clientId, r: redirectUri, s: state, pc: challenge, rs: resource, w: wantWrite ? McpAccessLevel.ReadWrite : McpAccessLevel.Read }, secret),
  };
}

/** Nhãn nơi quay về để hiện cho người dùng + có thuộc ứng dụng AI quen không. Nhãn là HOSTNAME — không userinfo, không cổng. */
export function redirectTarget(uri: string): { label: string; trusted: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return { label: "(không rõ)", trusted: false };
  }
  const host = parsed.hostname.toLowerCase();
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return { label: `máy tính của bạn (${host})`, trusted: true };
  if (scheme !== "http" && scheme !== "https") return { label: `ứng dụng cài trên máy (${scheme}://)`, trusted: false };
  return { label: host || "(không rõ)", trusted: KNOWN_REDIRECT_HOSTS.some((known) => host === known || host.endsWith(`.${known}`)) };
}

export interface ConsentView {
  clientName: string;
  redirectLabel: string;
  redirectTrusted: boolean;
  requestedLevel: McpAccessLevel;
}

export async function describeRequest(db: Db, token: string, secret: string): Promise<ConsentView> {
  const request = readRequest(token, secret);
  if (!request) throw new OAuthError("invalid_request", "Yêu cầu cấp quyền đã hết hạn hoặc không hợp lệ — quay lại ứng dụng AI và kết nối lại.");
  const client = await findClient(db, request.c);
  if (!client) throw new OAuthError("invalid_client", "Ứng dụng không còn đăng ký.");
  const target = redirectTarget(request.r);
  return { clientName: client.clientName, redirectLabel: target.label, redirectTrusted: target.trusted, requestedLevel: request.w as McpAccessLevel };
}

/** Người dùng bấm «Cho phép» → mã cấp quyền một lần → URL quay về ứng dụng (kèm code, state, iss). Chỉ Quản trị / Quản lý. */
export async function approveRequest(
  db: Db, principal: Principal, token: string, choice: { level: McpAccessLevel; includeConfidential: boolean }, base: string, secret: string,
): Promise<string> {
  if (principal.userId === null || !canUseMcp(principal.role)) throw new OAuthError("access_denied", "Chỉ Quản trị / Quản lý được nối ứng dụng AI với bot.", 403);
  const request = readRequest(token, secret);
  if (!request) throw new OAuthError("invalid_request", "Yêu cầu cấp quyền đã hết hạn — quay lại ứng dụng AI và kết nối lại.");
  const client = await findClient(db, request.c);
  if (!client) throw new OAuthError("invalid_client", "Ứng dụng không còn đăng ký.");
  // Mức thật = nhỏ nhất của (người dùng chọn, ứng dụng xin, vai trò cho phép); Mật chỉ khi người đó được xem Mật
  const level = Math.min(choice.level, request.w, maxAccessLevelForRole(principal.role)) as McpAccessLevel;
  const includeConfidential = choice.includeConfidential && canSeeConfidential(principal);
  const code = randomToken(32);
  await db.query(
    `INSERT INTO mcp_oauth_code (code_hash, client_pk, user_id, redirect_uri, code_challenge, resource, access_level, include_confidential, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3) + INTERVAL ${CODE_TTL_SECONDS} SECOND)`,
    [hashSecret(code), client.id, principal.userId, request.r, request.pc, request.rs ?? "", level, includeConfidential ? 1 : 0]);
  return redirectWith(request.r, { code, state: request.s, iss: base });
}

export function denyRequest(token: string, base: string, secret: string): string {
  const request = readRequest(token, secret);
  if (!request) throw new OAuthError("invalid_request", "Yêu cầu cấp quyền đã hết hạn.");
  return redirectWith(request.r, { error: "access_denied", error_description: "Người dùng từ chối.", state: request.s, iss: base });
}

// ---- token ---------------------------------------------------------------------------------------------------------

export function isPkceValid(verifier: string, challenge: string): boolean {
  if (!VERIFIER_PATTERN.test(verifier ?? "")) return false;
  return safeEqual(crypto.createHash("sha256").update(verifier).digest("base64url"), challenge ?? "");
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

const scopeText = (level: McpAccessLevel): string => (level === McpAccessLevel.ReadWrite ? `${SCOPE_READ} ${SCOPE_WRITE}` : SCOPE_READ);

/**
 * Sinh cặp mã mới cho dòng kết nối `keyId` (ghi băm). `expectedRefreshHash` (lượt làm mới): UPDATE có điều kiện mã làm mới hiện hành
 * KHỚP — hai lượt làm mới cùng lúc bằng cùng một mã thì chỉ một bên xoay được (review 27/10). Mã cũ chuyển sang `prev_refresh_hash`
 * để nhận ra ai dùng lại nó. Trả null khi điều kiện không khớp. Tiền tố trùng (1 / 62^8) thì sinh lại.
 */
async function rotateTokens(db: Db, keyId: number, level: McpAccessLevel, expectedRefreshHash: string | null = null): Promise<TokenResponse | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const access = generateMcpKey();
    const refresh = REFRESH_PREFIX + randomToken(40);
    const params: unknown[] = [access.prefix, access.tokenHash, hashSecret(refresh), keyId];
    if (expectedRefreshHash) params.push(expectedRefreshHash);
    try {
      const [result] = await db.query<ResultSetHeader>(
        `UPDATE mcp_api_key SET prefix = ?, token_hash = ?, prev_refresh_hash = refresh_hash, refresh_hash = ?,
           access_expires_at = NOW(3) + INTERVAL ${ACCESS_TTL_SECONDS} SECOND
         WHERE id = ? AND revoked_at IS NULL${expectedRefreshHash ? " AND refresh_hash = ?" : ""}`, params);
      if (!result.affectedRows) return null;
      return { access_token: access.token, token_type: "Bearer", expires_in: ACCESS_TTL_SECONDS, refresh_token: refresh, scope: scopeText(level) };
    } catch (error) {
      if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
    }
  }
  throw new OAuthError("server_error", "Không sinh được mã truy cập, thử lại.", 500);
}

export async function exchangeCode(
  db: Db, client: OAuthClientRow, input: { code: string; redirectUri: string; verifier: string; resource: string },
): Promise<TokenResponse> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT *, expires_at <= NOW(3) AS expired FROM mcp_oauth_code WHERE code_hash = ?", [hashSecret(input.code ?? "")]);
  const row = rows[0];
  if (!row || Number(row.client_pk) !== client.id) throw new OAuthError("invalid_grant", "Mã cấp quyền không hợp lệ.");
  // ĐỐT mã ngay TRƯỚC mọi kiểm tra — hai yêu cầu song song cùng mã thì chỉ một bên đổi được dòng; mã sai PKCE / sai redirect
  // cũng bị đốt (RFC 6749 §4.1.2: mã chỉ dùng một lần, kể cả lần hỏng).
  const [burned] = await db.query<ResultSetHeader>("UPDATE mcp_oauth_code SET used_at = NOW(3) WHERE id = ? AND used_at IS NULL", [row.id]);
  if (!burned.affectedRows) throw new OAuthError("invalid_grant", "Mã cấp quyền đã dùng rồi.");
  if (Number(row.expired)) throw new OAuthError("invalid_grant", "Mã cấp quyền đã hết hạn.");
  if ((input.redirectUri || row.redirect_uri) !== row.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri không khớp lúc xin cấp quyền.");
  if (!isPkceValid(input.verifier, String(row.code_challenge))) throw new OAuthError("invalid_grant", "code_verifier sai (PKCE).");
  const resource = String(row.resource ?? "");
  if (input.resource && resource && input.resource.replace(/\/+$/, "") !== resource.replace(/\/+$/, "")) {
    throw new OAuthError("invalid_target", "resource khác lúc xin cấp quyền.");
  }
  const userId = Number(row.user_id);
  const level = Number(row.access_level) as McpAccessLevel;
  // Cấp lại cho cùng người + ứng dụng → kết nối cũ chết (khỏi chất đống dòng, khỏi để mã cũ sống tiếp)
  await db.query(
    `UPDATE mcp_api_key SET revoked_at = NOW(3), revoked_by = 'Cấp lại OAuth', refresh_hash = NULL
     WHERE user_id = ? AND kind = ${McpKeyKind.OAuth} AND oauth_client_id = ? AND revoked_at IS NULL`, [userId, client.id]);
  const placeholder = generateMcpKey();
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO mcp_api_key (tenant_id, user_id, kind, oauth_client_id, name, prefix, token_hash, access_level, include_confidential, expires_at)
     SELECT tenant_id, id, ${McpKeyKind.OAuth}, ?, ?, ?, ?, ?, ?, NOW(3) + INTERVAL ${GRANT_DAYS} DAY FROM app_user WHERE id = ?`,
    [client.id, `Qua ${client.clientName}`.slice(0, 100), placeholder.prefix, placeholder.tokenHash, level, Number(row.include_confidential) ? 1 : 0, userId]);
  if (!result.affectedRows) throw new OAuthError("invalid_grant", "Tài khoản cấp quyền không còn.");
  await db.query("UPDATE mcp_oauth_client SET last_used_at = NOW(3) WHERE id = ?", [client.id]);
  const tokens = await rotateTokens(db, result.insertId, level);
  if (!tokens) throw new OAuthError("server_error", "Không cấp được mã truy cập, thử lại.", 500);
  return tokens;
}

export async function refreshTokens(db: Db, client: OAuthClientRow, refreshToken: string): Promise<TokenResponse> {
  const raw = refreshToken ?? "";
  const hash = raw.startsWith(REFRESH_PREFIX) ? hashSecret(raw) : "";
  const invalid = () => new OAuthError("invalid_grant", "Mã làm mới không hợp lệ hoặc kết nối đã bị thu hồi.");
  if (!hash) throw invalid();
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, user_id, oauth_client_id, access_level, revoked_at, expires_at IS NOT NULL AND expires_at <= NOW(3) AS expired
     FROM mcp_api_key WHERE refresh_hash = ? AND kind = ${McpKeyKind.OAuth}`, [hash]);
  const row = rows[0];
  if (!row) {
    // Mã làm mới CŨ (đã xoay) bị dùng lại = dấu mã bị lộ → thu hồi cả kết nối (RFC 9700 §4.14.2)
    const [reused] = await db.query<ResultSetHeader>(
      `UPDATE mcp_api_key SET revoked_at = NOW(3), revoked_by = 'Mã làm mới cũ bị dùng lại', refresh_hash = NULL
       WHERE prev_refresh_hash = ? AND kind = ${McpKeyKind.OAuth} AND oauth_client_id = ? AND revoked_at IS NULL`, [hash, client.id]);
    if (reused.affectedRows) throw new OAuthError("invalid_grant", "Mã làm mới đã dùng rồi — kết nối bị thu hồi để an toàn, hãy kết nối lại từ ứng dụng AI.");
    throw invalid();
  }
  if (Number(row.oauth_client_id) !== client.id || row.revoked_at) throw invalid();
  if (Number(row.expired)) throw new OAuthError("invalid_grant", "Kết nối đã hết hạn — kết nối lại từ ứng dụng AI.");
  const [owners] = await db.query<RowDataPacket[]>("SELECT role, is_active FROM app_user WHERE id = ?", [row.user_id]);
  if (!owners[0] || !owners[0].is_active || !canUseMcp(Number(owners[0].role))) {
    throw new OAuthError("invalid_grant", "Tài khoản không còn được dùng cổng MCP.");
  }
  const tokens = await rotateTokens(db, Number(row.id), Number(row.access_level) as McpAccessLevel, hash);
  if (!tokens) throw invalid();
  await db.query("UPDATE mcp_oauth_client SET last_used_at = NOW(3) WHERE id = ?", [client.id]);
  return tokens;
}

/** RFC 7009: thu hồi theo mã truy cập hoặc mã làm mới; mã lạ cũng coi là xong (không lộ gì). */
export async function revokeToken(db: Db, client: OAuthClientRow, token: string): Promise<void> {
  const raw = token ?? "";
  let column: string;
  let hash: string;
  if (raw.startsWith(REFRESH_PREFIX)) {
    column = "refresh_hash";
    hash = hashSecret(raw);
  } else {
    const parsed = parseMcpKey(raw);
    if (!parsed) return;
    column = "token_hash";
    hash = parsed.tokenHash;
  }
  await db.query(
    `UPDATE mcp_api_key SET revoked_at = NOW(3), revoked_by = 'Ứng dụng tự thu hồi', refresh_hash = NULL
     WHERE ${column} = ? AND kind = ${McpKeyKind.OAuth} AND oauth_client_id = ? AND revoked_at IS NULL`, [hash, client.id]);
}
