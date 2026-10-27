// 27/10/2026 — OAuth cho cổng /mcp đầu-cuối trên MySQL THẬT + máy chủ HTTP thật (cổng ngẫu nhiên): metadata → đăng ký ứng dụng
// → /oauth/authorize → màn đồng ý (phiên web) → đổi mã (PKCE) → gọi /mcp bằng mã truy cập → làm mới (xoay vòng) → thu hồi.
// Kèm các nhánh hỏng: PKCE sai (mã bị đốt), dùng lại mã, mã truy cập hết hạn, Nhân viên bị từ chối, chưa đăng nhập.
//
// Chạy: TEST_DATABASE_URL=mysql://root:test@127.0.0.1:3317/bot_tro_ly_test_a4 node --import tsx --test test/mcp-oauth.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { RowDataPacket } from "mysql2";
import { SESSION_COOKIE, SessionStore } from "../src/auth/session-store.js";
import type { AppConfig } from "../src/config.js";
import { McpKeyKind, UserRole } from "../src/constants.js";
import { REGISTER_PER_IP_PER_DAY } from "../src/mcp/oauth/mcp-oauth.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool, type Db } from "../src/db/pool.js";
import { createMcpGateway, type McpGateway } from "../src/mcp/mcp-http-handler.js";
import { createMcpOAuthRoutes } from "../src/mcp/oauth/mcp-oauth-http.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const TABLES = ["mcp_oauth_code", "mcp_oauth_client", "mcp_call_log", "web_session", "app_user"];
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

const config = {
  mcp: { enabled: true, allowedHosts: ["127.0.0.1"], rateLimitPerMinute: 60, maxConcurrentPerKey: 4, maxConcurrent: 3, queueWaitMs: 1000, badKeyLimitPerMinute: 1000, publicUrl: "" },
  privacy: { maskPersonalData: false },
  sessionEncryptionKey: "khoa-ky-thu-nghiem-0123456789abcdef0123456789",
} as unknown as AppConfig;

function parseCookie(header: string | undefined): string | undefined {
  return (header ?? "").split(";").map((part) => part.trim().split("=")).find(([name]) => name === SESSION_COOKIE)?.[1];
}

describe("OAuth cổng /mcp đầu-cuối (MySQL + HTTP thật)", { skip: !databaseUrl && "chưa đặt TEST_DATABASE_URL" }, () => {
  let db: Db;
  let gateway: McpGateway;
  let server: http.Server;
  let base = "";
  let sessions: SessionStore;
  const ids: Record<string, number> = {};
  const cookies: Record<string, string> = {};

  before(async () => {
    await runMigrations(databaseUrl!);
    db = createPool(databaseUrl!);
    sessions = new SessionStore(db);
    gateway = createMcpGateway(db, config);
    const oauth = createMcpOAuthRoutes({ db, config, sessions, registerPerMinute: 1000 });
    server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const run = async () => {
        if (url.pathname === "/mcp") return gateway.handle(request, response, "198.51.100.7");
        if (await oauth.handle(request, response, url.pathname, url, { token: parseCookie(request.headers.cookie), clientKey: "198.51.100.7" })) return;
        response.writeHead(404).end();
      };
      run().catch(() => response.destroy());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await gateway?.close();
    await db?.end();
  });

  async function addUser(name: string, role: UserRole): Promise<void> {
    const [result] = await db.query<any>("INSERT INTO app_user (username, email, full_name, role, all_groups, is_active) VALUES (?, ?, ?, ?, 1, 1)",
      [name, `${name}@ida.vn`, name, role]);
    ids[name] = Number(result.insertId);
    cookies[name] = `${SESSION_COOKIE}=${await sessions.create(ids[name])}`;
  }

  beforeEach(async () => {
    await db.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) await db.query(`TRUNCATE TABLE ${table}`);
    await db.query("DELETE FROM mcp_api_key");
    await db.query("SET FOREIGN_KEY_CHECKS = 1");
    await addUser("sep", UserRole.Manager);
    await addUser("nhanvien", UserRole.Staff);
  });

  const pkce = () => {
    const verifier = crypto.randomBytes(32).toString("base64url");
    return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
  };

  async function register(): Promise<string> {
    const response = await fetch(`${base}/oauth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
    });
    assert.equal(response.status, 201);
    return (await response.json()).client_id;
  }

  /** /authorize → lấy chuỗi yêu cầu ký từ đường chuyển sang màn đồng ý. */
  async function authorize(clientId: string, challenge: string, scope = "mcp:read"): Promise<string> {
    const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s1", scope, resource: `${base}/mcp` });
    const response = await fetch(`${base}/oauth/authorize?${query}`, { redirect: "manual" });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.pathname, "/oauth/consent");
    const page = await fetch(location);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Cho phép ứng dụng AI truy cập bot/);
    return location.searchParams.get("req")!;
  }

  async function consent(req: string, who: string | null, extra: Record<string, string> = {}): Promise<Response> {
    return fetch(`${base}/oauth/consent`, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base, ...(who ? { Cookie: cookies[who] } : {}) },
      body: new URLSearchParams({ req, decision: "allow", level: "1", ...extra }),
    });
  }

  async function token(form: Record<string, string>): Promise<{ status: number; body: any }> {
    const response = await fetch(`${base}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
    return { status: response.status, body: await response.json() };
  }

  async function obtainCode(clientId: string, challenge: string, who = "sep"): Promise<string> {
    const response = await consent(await authorize(clientId, challenge), who);
    assert.equal(response.status, 302);
    const back = new URL(response.headers.get("location")!);
    assert.equal(`${back.origin}${back.pathname}`, REDIRECT);
    assert.equal(back.searchParams.get("state"), "s1");
    assert.equal(back.searchParams.get("iss"), base);
    return back.searchParams.get("code")!;
  }

  const mcpStatus = async (accessToken: string) => (await fetch(`${base}/mcp`, {
    method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${accessToken}` },
  })).status;

  test("metadata + 401 của /mcp chỉ đường tới metadata", async () => {
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    assert.equal(as.issuer, base);
    assert.equal(as.token_endpoint, `${base}/oauth/token`);
    const pr = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    assert.equal(pr.headers.get("access-control-allow-origin"), "*");
    assert.equal((await pr.json()).resource, `${base}/mcp`);
    const unauthorized = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("www-authenticate")!, /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/);
  });

  test("luồng đủ: đăng ký → đồng ý → đổi mã → gọi /mcp → làm mới xoay vòng → thu hồi; kết nối là một dòng mcp_api_key loại OAuth", async () => {
    const clientId = await register();
    const { verifier, challenge } = pkce();
    const code = await obtainCode(clientId, challenge);
    const issued = await token({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: REDIRECT, code_verifier: verifier, resource: `${base}/mcp` });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    assert.equal(issued.body.token_type, "Bearer");
    assert.equal(issued.body.scope, "mcp:read");
    assert.match(issued.body.access_token, /^idamcp_/);
    assert.match(issued.body.refresh_token, /^idamcr_/);

    const client = new Client({ name: "oauth-it", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${issued.body.access_token}` } } }));
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      assert.ok(names.includes("query_records"));
      assert.ok(names.every((name) => !/^propose_|^confirm_write$/.test(name)), "chỉ đọc thì không thấy công cụ ghi");
    } finally { await client.close(); }

    const [grants] = await db.query<RowDataPacket[]>("SELECT user_id, kind, name, refresh_hash IS NOT NULL AS has_refresh FROM mcp_api_key");
    assert.deepEqual(grants.map((row) => [Number(row.user_id), Number(row.kind), row.name, Number(row.has_refresh)]), [[ids.sep, McpKeyKind.OAuth, "Qua Claude", 1]]);

    const refreshed = await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: issued.body.refresh_token });
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.body.access_token, issued.body.access_token);
    assert.equal(await mcpStatus(issued.body.access_token), 401, "mã truy cập cũ chết sau khi xoay vòng");
    assert.equal(await mcpStatus(refreshed.body.access_token), 200);
    assert.equal((await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: issued.body.refresh_token })).status, 400, "mã làm mới cũ không dùng lại được");

    const revoked = await fetch(`${base}/oauth/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, token: refreshed.body.refresh_token }) });
    assert.equal(revoked.status, 200);
    assert.equal(await mcpStatus(refreshed.body.access_token), 401);
  });

  test("PKCE sai → invalid_grant và mã bị đốt; dùng lại mã → invalid_grant", async () => {
    const clientId = await register();
    const { verifier, challenge } = pkce();
    const code = await obtainCode(clientId, challenge);
    const wrong = await token({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: REDIRECT, code_verifier: pkce().verifier });
    assert.deepEqual([wrong.status, wrong.body.error], [400, "invalid_grant"]);
    const again = await token({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: REDIRECT, code_verifier: verifier });
    assert.deepEqual([again.status, again.body.error], [400, "invalid_grant"]);
    assert.match(again.body.error_description, /đã dùng/);
  });

  test("mã truy cập hết hạn → 401; làm mới lấy mã mới thì chạy lại", async () => {
    const clientId = await register();
    const { verifier, challenge } = pkce();
    const issued = (await token({ grant_type: "authorization_code", client_id: clientId, code: await obtainCode(clientId, challenge), redirect_uri: REDIRECT, code_verifier: verifier })).body;
    assert.equal(await mcpStatus(issued.access_token), 200);
    await db.query("UPDATE mcp_api_key SET access_expires_at = NOW(3) - INTERVAL 1 SECOND");
    assert.equal(await mcpStatus(issued.access_token), 401);
    const refreshed = await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: issued.refresh_token });
    assert.equal(await mcpStatus(refreshed.body.access_token), 200);
  });

  test("Nhân viên bị từ chối ở màn đồng ý; chưa đăng nhập thì được nhắc đăng nhập; Từ chối trả access_denied về ứng dụng", async () => {
    const clientId = await register();
    const { challenge } = pkce();
    const staff = await consent(await authorize(clientId, challenge), "nhanvien");
    assert.equal(staff.status, 403);
    assert.match(await staff.text(), /chỉ\s+Quản trị \/ Quản lý/);
    const anonymous = await consent(await authorize(clientId, challenge), null);
    assert.equal(anonymous.status, 401);
    assert.match(await anonymous.text(), /chưa đăng nhập/);
    const denied = await consent(await authorize(clientId, challenge), "sep", { decision: "deny" });
    assert.equal(denied.status, 302);
    assert.equal(new URL(denied.headers.get("location")!).searchParams.get("error"), "access_denied");
    const [codes] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM mcp_oauth_code");
    assert.equal(Number(codes[0].total), 0, "không mã nào được cấp");
  });

  test("ứng dụng xin ghi nhưng người dùng chỉ chọn đọc → mã chỉ đọc; chọn ghi → có công cụ ghi; Origin lạ ở màn đồng ý → 403", async () => {
    const clientId = await register();
    const read = pkce();
    const readOnly = await consent(await authorize(clientId, read.challenge, "mcp:read mcp:write"), "sep", { level: "1" });
    const readCode = new URL(readOnly.headers.get("location")!).searchParams.get("code")!;
    const readIssued = await token({ grant_type: "authorization_code", client_id: clientId, code: readCode, redirect_uri: REDIRECT, code_verifier: read.verifier });
    assert.equal(readIssued.body.scope, "mcp:read");
    const write = pkce();
    const req = await authorize(clientId, write.challenge, "mcp:read mcp:write");
    const response = await consent(req, "sep", { level: "2" });
    const code = new URL(response.headers.get("location")!).searchParams.get("code")!;
    const issued = await token({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: REDIRECT, code_verifier: write.verifier });
    assert.equal(issued.body.scope, "mcp:read mcp:write");
    const evil = await fetch(`${base}/oauth/consent`, {
      method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example", Cookie: cookies.sep },
      body: new URLSearchParams({ req, decision: "allow", level: "2" }),
    });
    assert.equal(evil.status, 403);
  });

  async function issue(clientId: string): Promise<{ access_token: string; refresh_token: string }> {
    const { verifier, challenge } = pkce();
    const result = await token({ grant_type: "authorization_code", client_id: clientId, code: await obtainCode(clientId, challenge), redirect_uri: REDIRECT, code_verifier: verifier });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  }

  test("dùng lại mã làm mới CŨ → thu hồi cả kết nối (mã mới cũng chết); mã làm mới của ứng dụng khác → invalid_grant", async () => {
    const clientId = await register();
    const first = await issue(clientId);
    const second = (await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: first.refresh_token })).body;
    const reuse = await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: first.refresh_token });
    assert.deepEqual([reuse.status, reuse.body.error], [400, "invalid_grant"]);
    assert.match(reuse.body.error_description, /thu hồi/);
    assert.equal(await mcpStatus(second.access_token), 401, "kết nối đã bị thu hồi");
    assert.equal((await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: second.refresh_token })).status, 400);

    const otherClient = await register();
    const mine = await issue(clientId);
    const stolen = await token({ grant_type: "refresh_token", client_id: otherClient, refresh_token: mine.refresh_token });
    assert.deepEqual([stolen.status, stolen.body.error], [400, "invalid_grant"]);
    assert.equal(await mcpStatus(mine.access_token), 200, "mã của ứng dụng khác bị từ chối nhưng không giết kết nối thật");
  });

  test("hai lượt làm mới cùng lúc bằng một mã: chỉ một lượt xoay được", async () => {
    const clientId = await register();
    const first = await issue(clientId);
    const results = await Promise.all([1, 2].map(() => token({ grant_type: "refresh_token", client_id: clientId, refresh_token: first.refresh_token })));
    assert.equal(results.filter((result) => result.status === 200).length, 1);
  });

  test("bị hạ xuống Nhân viên: /mcp 401 và làm mới bị từ chối", async () => {
    const clientId = await register();
    const issued = await issue(clientId);
    await db.query("UPDATE app_user SET role = ? WHERE id = ?", [UserRole.Staff, ids.sep]);
    assert.equal(await mcpStatus(issued.access_token), 401);
    const refreshed = await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: issued.refresh_token });
    assert.deepEqual([refreshed.status, refreshed.body.error], [400, "invalid_grant"]);
  });

  test("đổi mã: redirect_uri khác lúc xin → invalid_grant; mã quá hạn → invalid_grant", async () => {
    const clientId = await register();
    const one = pkce();
    const code = await obtainCode(clientId, one.challenge);
    const wrongRedirect = await token({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: "https://claude.ai/khac", code_verifier: one.verifier });
    assert.deepEqual([wrongRedirect.status, wrongRedirect.body.error], [400, "invalid_grant"]);
    const two = pkce();
    const late = await obtainCode(clientId, two.challenge);
    await db.query("UPDATE mcp_oauth_code SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE used_at IS NULL");
    const expired = await token({ grant_type: "authorization_code", client_id: clientId, code: late, redirect_uri: REDIRECT, code_verifier: two.verifier });
    assert.deepEqual([expired.status, expired.body.error], [400, "invalid_grant"]);
    assert.match(expired.body.error_description, /hết hạn/);
  });

  test("/authorize: redirect_uri chưa đăng ký → trang lỗi, không chuyển hướng; resource lạ → invalid_target về ứng dụng", async () => {
    const clientId = await register();
    const { challenge } = pkce();
    const query = (extra: Record<string, string>) => new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", ...extra });
    const unregistered = await fetch(`${base}/oauth/authorize?${query({ redirect_uri: "https://claude.ai/khac" })}`, { redirect: "manual" });
    assert.equal(unregistered.status, 400);
    assert.equal(unregistered.headers.get("location"), null);
    const wrongResource = await fetch(`${base}/oauth/authorize?${query({ resource: `${base}/mcp-gia` })}`, { redirect: "manual" });
    assert.equal(wrongResource.status, 302);
    assert.equal(new URL(wrongResource.headers.get("location")!).searchParams.get("error"), "invalid_target");
  });

  test("màn đồng ý không nhúng khung được (X-Frame-Options + frame-ancestors)", async () => {
    const clientId = await register();
    const req = await authorize(clientId, pkce().challenge);
    const page = await fetch(`${base}/oauth/consent?req=${encodeURIComponent(req)}`);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.match(page.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  });

  test(`đăng ký: một IP quá ${REGISTER_PER_IP_PER_DAY} ứng dụng / ngày → 429 (không khóa máy khác)`, async () => {
    for (let index = 0; index < REGISTER_PER_IP_PER_DAY; index += 1) {
      await db.query("INSERT INTO mcp_oauth_client (client_id, client_name, redirect_uris, ip) VALUES (?, 'x', '[]', '198.51.100.7')", [`idaoc_fill${index}`]);
    }
    const blocked = await fetch(`${base}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [REDIRECT] }) });
    assert.equal(blocked.status, 429);
  });

  test("đăng ký: redirect_uri http ngoài / thiếu → 400; client_id lạ ở /authorize → trang lỗi, không chuyển hướng", async () => {
    const bad = await fetch(`${base}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "invalid_redirect_uri");
    const unknown = await fetch(`${base}/oauth/authorize?client_id=idaoc_khong_co&redirect_uri=${encodeURIComponent(REDIRECT)}`, { redirect: "manual" });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.headers.get("location"), null);
  });
});
