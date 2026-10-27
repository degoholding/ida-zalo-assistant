import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { McpAccessLevel } from "../../constants.js";
import { escapeHtml, renderConsentPage } from "./mcp-oauth-pages.js";
import {
  authorizationServerMetadata, isPkceValid, isValidRedirectUri, OAuthError, protectedResourceMetadata, readRequest, redirectTarget,
  redirectWith, resolveIssuer, signRequest,
} from "./mcp-oauth.js";

const SECRET = "khoa-ky-thu-nghiem-0123456789abcdef";
const BASE = "https://botida.degoholding.vn";

test("metadata: issuer, đường cấp quyền / token / đăng ký, PKCE S256, tài nguyên /mcp trỏ về máy chủ cấp quyền", () => {
  const as = authorizationServerMetadata(BASE);
  assert.equal(as.issuer, BASE);
  assert.equal(as.authorization_endpoint, `${BASE}/oauth/authorize`);
  assert.equal(as.token_endpoint, `${BASE}/oauth/token`);
  assert.equal(as.registration_endpoint, `${BASE}/oauth/register`);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  const pr = protectedResourceMetadata(BASE);
  assert.equal(pr.resource, `${BASE}/mcp`);
  assert.deepEqual(pr.authorization_servers, [BASE]);
});

test("issuer: chỉ lấy MCP_PUBLIC_URL; chưa khai thì máy local dùng Host, máy khác 503 (không tin Host giả)", () => {
  assert.equal(resolveIssuer(`${BASE}/`, "evil.example"), BASE);
  assert.equal(resolveIssuer("", "127.0.0.1:8090"), "http://127.0.0.1:8090");
  assert.equal(resolveIssuer("", "localhost:8090"), "http://localhost:8090");
  assert.throws(() => resolveIssuer("", "botida.degoholding.vn"), (error: unknown) => error instanceof OAuthError && error.status === 503);
});

test("redirect_uri: https / http cục bộ / lược đồ riêng được; http ngoài, #, userinfo, javascript: bị chặn", () => {
  for (const ok of ["https://claude.ai/api/mcp/auth_callback", "https://chatgpt.com/connector_platform_oauth_redirect", "http://127.0.0.1:33418/callback", "http://localhost/cb", "cursor://anysphere.cursor-retrieval/oauth"]) {
    assert.equal(isValidRedirectUri(ok), true, ok);
  }
  for (const bad of ["http://evil.example/cb", "https://claude.ai/cb#x", "https://chatgpt.com@evil.example/cb", "javascript:alert(1)", "data:text/html,x", "", 42, "x".repeat(600)]) {
    assert.equal(isValidRedirectUri(bad), false, String(bad).slice(0, 40));
  }
});

test("nơi quay về: ứng dụng quen được tin, tên miền giả bằng userinfo không lừa được nhãn", () => {
  assert.deepEqual(redirectTarget("https://claude.ai/api/mcp/auth_callback"), { label: "claude.ai", trusted: true });
  assert.equal(redirectTarget("https://chatgpt.com/cb").trusted, true);
  assert.deepEqual(redirectTarget("https://evil.example/cb"), { label: "evil.example", trusted: false });
  assert.equal(redirectTarget("http://127.0.0.1:5000/cb").trusted, true);
});

test("chuỗi yêu cầu ký HMAC: đọc lại đúng; sửa một ký tự, sai khóa, hoặc quá 10 phút → null", () => {
  const data = { c: "idaoc_x", r: "https://claude.ai/cb", s: "st", pc: "c".repeat(43), rs: "", w: McpAccessLevel.Read };
  const now = Date.now();
  const token = signRequest(data, SECRET, now);
  assert.deepEqual({ ...readRequest(token, SECRET, now), exp: 0 }, { ...data, exp: 0 });
  const tampered = token.replace(/.$/, (char) => (char === "a" ? "b" : "a"));
  assert.equal(readRequest(tampered, SECRET, now), null);
  assert.equal(readRequest(token, "khoa-khac", now), null);
  assert.equal(readRequest(token, SECRET, now + 11 * 60 * 1000), null);
  assert.equal(readRequest("rac", SECRET, now), null);
});

test("PKCE S256: đúng verifier qua; sai / ngắn / ký tự lạ thì trượt", () => {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  assert.equal(isPkceValid(verifier, challenge), true);
  assert.equal(isPkceValid(`${verifier}x`, challenge), false);
  assert.equal(isPkceValid("ngan", crypto.createHash("sha256").update("ngan").digest("base64url")), false);
  assert.equal(isPkceValid(`${verifier}!`, challenge), false);
});

test("redirectWith giữ query sẵn có, bỏ tham số rỗng", () => {
  assert.equal(redirectWith("https://claude.ai/cb?a=1", { code: "x", state: "", iss: BASE }), `https://claude.ai/cb?a=1&code=x&iss=${encodeURIComponent(BASE)}`);
});

test("màn đồng ý: thoát HTML tên ứng dụng, cảnh báo nơi quay về lạ, chỉ hiện lựa chọn ghi khi ứng dụng xin ghi", () => {
  const html = renderConsentPage({
    view: { clientName: "<script>x</script>", redirectLabel: "evil.example", redirectTrusted: false, requestedLevel: McpAccessLevel.Read },
    requestToken: "abc\"def",
  });
  assert.ok(!html.includes("<script>x</script>"));
  assert.ok(html.includes(escapeHtml("<script>x</script>")));
  assert.ok(html.includes("KHÔNG phải ứng dụng AI quen"));
  assert.ok(html.includes('value="abc&quot;def"'));
  assert.ok(!html.includes(`value="${McpAccessLevel.ReadWrite}"`));
  const write = renderConsentPage({ view: { clientName: "Claude", redirectLabel: "claude.ai", redirectTrusted: true, requestedLevel: McpAccessLevel.ReadWrite }, requestToken: "t" });
  assert.ok(write.includes(`value="${McpAccessLevel.ReadWrite}"`));
  assert.ok(!write.includes("KHÔNG phải ứng dụng AI quen"));
  assert.ok(!/«|»/.test(write), "giao diện không dùng ngoặc kép góc");
});
