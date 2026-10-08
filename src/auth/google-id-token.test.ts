import assert from "node:assert/strict";
import { test } from "node:test";
import { GoogleTokenError, verifyGoogleIdToken } from "./google-id-token.js";

const CLIENT = "123-abc.apps.googleusercontent.com";
const TOKEN = "aaa.bbb.ccc";
const NOW = Date.UTC(2026, 9, 8, 3, 0, 0);

function googleSays(body: Record<string, unknown>, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

const valid = { aud: CLIENT, iss: "https://accounts.google.com", exp: String(NOW / 1000 + 600), email: "Lan@IDA.vn", email_verified: "true", name: "Lan", sub: "42" };

test("a valid token gives the lower-cased email", async () => {
  const identity = await verifyGoogleIdToken(TOKEN, CLIENT, googleSays(valid), NOW);
  assert.deepEqual(identity, { email: "lan@ida.vn", name: "Lan", sub: "42" });
});

test("a token minted for another app, by another issuer, expired or with an unverified email is refused", async () => {
  for (const bad of [
    { ...valid, aud: "other.apps.googleusercontent.com" },
    { ...valid, iss: "evil.example.com" },
    { ...valid, exp: String(NOW / 1000 - 1) },
    { ...valid, email_verified: "false" },
    { ...valid, email: "" },
  ]) {
    await assert.rejects(verifyGoogleIdToken(TOKEN, CLIENT, googleSays(bad), NOW), GoogleTokenError);
  }
});

test("Google rejecting the token, a malformed token, or a missing client id are refused before trusting anything", async () => {
  await assert.rejects(verifyGoogleIdToken(TOKEN, CLIENT, googleSays({}, false), NOW), /không xác nhận/);
  let called = false;
  const spy = (async () => { called = true; return { ok: true, json: async () => valid }; }) as unknown as typeof fetch;
  await assert.rejects(verifyGoogleIdToken("not-a-jwt", CLIENT, spy, NOW), /không hợp lệ/);
  await assert.rejects(verifyGoogleIdToken("a.b.c\"&x=1", CLIENT, spy, NOW), /không hợp lệ/);
  await assert.rejects(verifyGoogleIdToken(TOKEN, "", spy, NOW), /Client ID/);
  assert.equal(called, false);
});
