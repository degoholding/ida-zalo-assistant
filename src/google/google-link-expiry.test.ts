import assert from "node:assert/strict";
import test from "node:test";
import {
  GoogleUserAuth, RECONNECT_TEXT, TESTING_TOKEN_LIFETIME_DAYS, assessGoogleLink, clearGoogleRefreshFailure, getGoogleRefreshFailure, googleLinkExpiry,
} from "./google-oauth.js";

const DAY = 24 * 60 * 60 * 1000;
const CLIENT = { client_id: "id", client_secret: "secret" };

test("googleLinkExpiry: 7 ngày kể từ lúc đồng ý; dưới 1 ngày là sắp hết, quá là hết", () => {
  const connectedAt = Date.parse("2026-10-20T08:00:00.000Z");
  const fresh = googleLinkExpiry("2026-10-20T08:00:00.000Z", connectedAt + DAY);
  assert.equal(fresh.expires_at, new Date(connectedAt + TESTING_TOKEN_LIFETIME_DAYS * DAY).toISOString());
  assert.equal(fresh.days_left, 6);
  assert.equal(fresh.expired, false);

  const lastDay = googleLinkExpiry("2026-10-20T08:00:00.000Z", connectedAt + 6.5 * DAY);
  assert.ok(lastDay.days_left !== null && lastDay.days_left < 1 && lastDay.days_left > 0);
  assert.equal(lastDay.expired, false);

  const gone = googleLinkExpiry("2026-10-20T08:00:00.000Z", connectedAt + 8 * DAY);
  assert.equal(gone.expired, true);
  assert.ok(gone.days_left !== null && gone.days_left < 0);
});

test("googleLinkExpiry: không biết lúc kết nối (kết nối cũ / chuỗi rác) thì hạn chưa rõ, không coi là hết", () => {
  assert.deepEqual(googleLinkExpiry(undefined), { expires_at: null, days_left: null, expired: false });
  assert.deepEqual(googleLinkExpiry("rác"), { expires_at: null, days_left: null, expired: false });
});

test("assessGoogleLink chế độ Testing (mặc định): xanh khi còn hạn, sắp hết dưới 1 ngày, hết khi quá 7 ngày hoặc Google từ chối", () => {
  const at = "2026-10-20T08:00:00.000Z";
  const t0 = Date.parse(at);
  assert.equal(assessGoogleLink({ connected: true, connectedAt: at, testing: true, refused: false, now: t0 + DAY }).health, "ok");
  const soon = assessGoogleLink({ connected: true, connectedAt: at, testing: true, refused: false, now: t0 + 6.5 * DAY });
  assert.equal(soon.health, "expiring");
  assert.ok(soon.expires_at);
  assert.equal(assessGoogleLink({ connected: true, connectedAt: at, testing: true, refused: false, now: t0 + 8 * DAY }).health, "expired");
  assert.equal(assessGoogleLink({ connected: true, connectedAt: at, testing: true, refused: true, now: t0 + DAY }).health, "expired");
  // Không biết lúc kết nối: chưa chấm hạn, vẫn ok tới khi Google từ chối
  assert.deepEqual(assessGoogleLink({ connected: true, connectedAt: null, testing: true, refused: false }), { expires_at: null, days_left: null, expired: false, health: "ok" });
  assert.equal(assessGoogleLink({ connected: false, connectedAt: at, testing: true, refused: true }).health, "disconnected");
});

test("assessGoogleLink chế độ In production (GOOGLE_OAUTH_TESTING=false): bỏ hạn 7 ngày, chỉ đỏ khi Google từ chối hoặc chưa kết nối", () => {
  const at = "2026-10-20T08:00:00.000Z";
  const t0 = Date.parse(at);
  const old = assessGoogleLink({ connected: true, connectedAt: at, testing: false, refused: false, now: t0 + 30 * DAY });
  assert.deepEqual(old, { expires_at: null, days_left: null, expired: false, health: "ok" }, "quá 7 ngày vẫn xanh, không có expires_at / days_left");
  assert.equal(assessGoogleLink({ connected: true, connectedAt: at, testing: false, refused: false, now: t0 + 6.9 * DAY }).health, "ok", "không có mức expiring");
  assert.equal(assessGoogleLink({ connected: true, connectedAt: at, testing: false, refused: true, now: t0 + DAY }).health, "expired");
  assert.equal(assessGoogleLink({ connected: false, connectedAt: null, testing: false, refused: false }).health, "disconnected");
});

test("refresh token bị Google từ chối (invalid_grant) thì ghi nhớ lỗi; làm mới thành công / xóa tay thì hết", async () => {
  clearGoogleRefreshFailure();
  const reject = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
  const auth = new GoogleUserAuth(CLIENT, { email: "a@gmail.com", refresh_token: "rt" }, reject, () => 1_000_000);
  await assert.rejects(auth.getAccessToken(), (error: Error) => error.message === RECONNECT_TEXT);
  assert.equal(getGoogleRefreshFailure()?.message, RECONNECT_TEXT);
  assert.equal(getGoogleRefreshFailure()?.at, new Date(1_000_000).toISOString());

  const ok = (async () => new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch;
  const auth2 = new GoogleUserAuth(CLIENT, { email: "a@gmail.com", refresh_token: "rt" }, ok, () => 2_000_000);
  assert.equal(await auth2.getAccessToken(), "at");
  assert.equal(getGoogleRefreshFailure(), null);

  const netDown = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
  const auth3 = new GoogleUserAuth(CLIENT, { email: "a@gmail.com", refresh_token: "rt" }, netDown, () => 3_000_000);
  await assert.rejects(auth3.getAccessToken());
  assert.equal(getGoogleRefreshFailure(), null, "lỗi mạng không bị tính là mất kết nối Google");
});
