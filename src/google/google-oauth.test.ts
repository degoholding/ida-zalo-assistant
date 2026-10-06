import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GoogleUserAuth, RECONNECT_TEXT, buildAuthUrl, consumeOAuthState, createOAuthState, emailFromIdToken, exchangeAuthCode, oauthClientOf,
} from "./google-oauth.js";
import { GoogleSheetsError } from "./sheets-error-messages.js";

const CLIENT = { client_id: "123-abc.apps.googleusercontent.com", client_secret: "GOCSPX-secret" };
const idToken = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
const fakeFetch = (status: number, body: object, calls: { body: string }[] = []) =>
  (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ body: String(init?.body ?? "") });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;

test("the OAuth client comes from the Client ID + Client secret boxes; both are required", () => {
  assert.deepEqual(oauthClientOf({ oauthClientId: CLIENT.client_id, oauthClientSecret: CLIENT.client_secret }), CLIENT);
  assert.equal(oauthClientOf({ oauthClientId: CLIENT.client_id, oauthClientSecret: "" }), null);
  assert.equal(oauthClientOf({ oauthClientId: "", oauthClientSecret: "s" }), null);
});

test("the consent URL asks for offline access, calendar scope and carries the state", () => {
  const url = new URL(buildAuthUrl(CLIENT, "http://localhost:8090/api/google/oauth/callback", "st4te"));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "st4te");
  assert.match(url.searchParams.get("scope") ?? "", /calendar\.events/);
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:8090/api/google/oauth/callback");
});

test("state values are single-use and expire after ten minutes", () => {
  const state = createOAuthState("http://localhost:8090/cb", 1_000);
  assert.deepEqual(consumeOAuthState(state, 2_000), { redirectUri: "http://localhost:8090/cb" });
  assert.equal(consumeOAuthState(state, 2_000), null);
  const old = createOAuthState("http://localhost:8090/cb", 0);
  assert.equal(consumeOAuthState(old, 11 * 60_000), null);
  assert.equal(consumeOAuthState("bia-ra", 0), null);
});

test("exchanging the code returns the refresh token and the account email", async () => {
  const calls: { body: string }[] = [];
  const account = await exchangeAuthCode(CLIENT, "c0de", "http://localhost:8090/cb",
    fakeFetch(200, { refresh_token: "1//rt", access_token: "at", scope: "openid https://www.googleapis.com/auth/calendar.events email", id_token: idToken({ email: "duoc@gmail.com" }) }, calls));
  assert.deepEqual(account, { email: "duoc@gmail.com", refresh_token: "1//rt" });
  assert.equal(new URLSearchParams(calls[0].body).get("grant_type"), "authorization_code");
  await assert.rejects(exchangeAuthCode(CLIENT, "c0de", "x", fakeFetch(200, { access_token: "at", scope: "https://www.googleapis.com/auth/calendar.events" })), /refresh token/);
  assert.equal(emailFromIdToken("khong-phai-jwt"), "");
});

// Gặp thật 06/10/2026: ô tick quyền lịch để trống → Google chỉ cấp email; phải báo ngay, không lưu kết nối nửa vời
test("connecting without ticking the calendar permission is refused with instructions", async () => {
  await assert.rejects(
    exchangeAuthCode(CLIENT, "c0de", "x", fakeFetch(200, { refresh_token: "1//rt", access_token: "at", scope: "openid https://www.googleapis.com/auth/userinfo.email" })),
    (error) => error instanceof GoogleSheetsError && /TICK ô/.test(error.message),
  );
});

test("expired or revoked refresh tokens tell the admin to reconnect", async () => {
  const auth = new GoogleUserAuth(CLIENT, { email: "a@gmail.com", refresh_token: "rt" }, fakeFetch(400, { error: "invalid_grant" }));
  await assert.rejects(auth.getAccessToken(), (error) => error instanceof GoogleSheetsError && error.message === RECONNECT_TEXT);
});

test("access tokens are cached until a minute before expiry", async () => {
  const calls: { body: string }[] = [];
  let now = 0;
  const auth = new GoogleUserAuth(CLIENT, { email: "a@gmail.com", refresh_token: "rt" }, fakeFetch(200, { access_token: "at", expires_in: 3600 }, calls), () => now);
  await auth.getAccessToken();
  await auth.getAccessToken();
  assert.equal(calls.length, 1);
  now = 3600_000 - 59_000;
  await auth.getAccessToken();
  assert.equal(calls.length, 2);
});
