import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import type { ServiceAccount } from "./service-account.js";
import { GoogleSheetsClient, TEST_SHEET_TITLE, sheetRange, testSheetsConnection } from "./sheets-client.js";
import {
  GoogleSheetsError,
  INVALID_GRANT_TEXT,
  NETWORK_ERROR_TEXT,
  NOT_FOUND_TEXT,
  RATE_LIMIT_TEXT,
  SERVICE_DISABLED_TEXT,
  permissionDeniedText,
} from "./sheets-error-messages.js";

// Không gọi mạng thật: tiêm fetcher giả, ghi lại mọi lời gọi.

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const ACCOUNT: ServiceAccount = {
  type: "service_account",
  client_email: "bot@demo.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  token_uri: "https://oauth2.googleapis.com/token",
  project_id: "demo",
};
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown };
interface Call { url: string; init: RequestInit }

function fakeFetch(handler: Handler): { fetcher: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetcher, calls };
}

const tokenOk = { status: 200, body: { access_token: "tok-1", expires_in: 3600 } };

/** Google bình thường: đổi token được, trang tính có sẵn các tab `tabs`. */
function happyGoogle(tabs: string[]): Handler {
  return (url) => {
    if (url.startsWith(ACCOUNT.token_uri)) return tokenOk;
    if (url.includes(":batchUpdate")) return { status: 200, body: {} };
    if (url.includes(":append")) return { status: 200, body: { updates: { updatedRange: "'Bot trợ lý'!A5:C5" } } };
    return { status: 200, body: { properties: { title: "Báo cáo" }, sheets: tabs.map((title, sheetId) => ({ properties: { title, sheetId } })) } };
  };
}

test("signs a valid RS256 JWT with the expected claims", () => {
  const now = Date.parse("2026-10-03T00:00:00Z");
  const client = new GoogleSheetsClient(ACCOUNT, { now: () => now });
  const [header, claim, signature] = client.buildSignedJwt().split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const payload = JSON.parse(Buffer.from(claim, "base64url").toString());
  assert.equal(payload.iss, ACCOUNT.client_email);
  assert.equal(payload.scope, "https://www.googleapis.com/auth/spreadsheets");
  assert.equal(payload.aud, ACCOUNT.token_uri);
  assert.equal(payload.exp - payload.iat, 3600);
  assert.ok(crypto.verify("RSA-SHA256", Buffer.from(`${header}.${claim}`), publicKey, Buffer.from(signature, "base64url")));
});

test("caches the access token until 60 seconds before expiry", async () => {
  let now = 1_000_000;
  const { fetcher, calls } = fakeFetch(() => tokenOk);
  const client = new GoogleSheetsClient(ACCOUNT, { fetcher, now: () => now });
  await client.getAccessToken();
  await client.getAccessToken();
  assert.equal(calls.length, 1);
  const tokenBody = new URLSearchParams(String(calls[0].init.body));
  assert.equal(tokenBody.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  now += 3600_000 - 59_000;
  await client.getAccessToken();
  assert.equal(calls.length, 2);
});

test("ensureSheet only adds the tab when it is missing", async () => {
  const existing = fakeFetch(happyGoogle(["Sheet1", TEST_SHEET_TITLE]));
  await new GoogleSheetsClient(ACCOUNT, { fetcher: existing.fetcher }).ensureSheet(SHEET_ID, TEST_SHEET_TITLE);
  assert.equal(existing.calls.filter((call) => call.url.includes(":batchUpdate")).length, 0);

  const missing = fakeFetch(happyGoogle(["Sheet1"]));
  await new GoogleSheetsClient(ACCOUNT, { fetcher: missing.fetcher }).ensureSheet(SHEET_ID, TEST_SHEET_TITLE);
  const adds = missing.calls.filter((call) => call.url.includes(":batchUpdate"));
  assert.equal(adds.length, 1);
  assert.deepEqual(JSON.parse(String(adds[0].init.body)), { requests: [{ addSheet: { properties: { title: TEST_SHEET_TITLE } } }] });
});

test("quotes sheet titles with spaces and apostrophes in ranges", async () => {
  assert.equal(sheetRange("Bot trợ lý"), "'Bot trợ lý'!A1");
  assert.equal(sheetRange("Anh's sheet"), "'Anh''s sheet'!A1");
  const { fetcher, calls } = fakeFetch(happyGoogle([]));
  await new GoogleSheetsClient(ACCOUNT, { fetcher }).appendRows(SHEET_ID, "Anh's sheet", [["a"]]);
  const append = calls.find((call) => call.url.includes(":append"))!;
  assert.ok(append.url.includes(encodeURIComponent("'Anh''s sheet'!A1")));
  assert.equal((append.init.headers as Record<string, string>).Authorization, "Bearer tok-1");
});

test("testSheetsConnection writes one row into the Bot trợ lý tab", async () => {
  const { fetcher, calls } = fakeFetch(happyGoogle([]));
  const result = await testSheetsConnection(new GoogleSheetsClient(ACCOUNT, { fetcher }), SHEET_ID, Date.parse("2026-10-03T01:00:00Z"));
  assert.deepEqual(result, { ok: true, spreadsheet_title: "Báo cáo", sheet_title: TEST_SHEET_TITLE, appended_range: "'Bot trợ lý'!A5:C5" });
  const append = calls.find((call) => call.url.includes(":append"))!;
  assert.deepEqual(JSON.parse(String(append.init.body)), { values: [["2026-10-03 08:00:00", "Kết nối thử từ Bot trợ lý", ACCOUNT.client_email]] });
});

async function failureOf(handler: Handler): Promise<string> {
  const { fetcher } = fakeFetch(handler);
  try {
    await new GoogleSheetsClient(ACCOUNT, { fetcher }).getSpreadsheet(SHEET_ID);
  } catch (error) {
    assert.ok(error instanceof GoogleSheetsError);
    return error.message;
  }
  assert.fail("không ném lỗi");
}

const sheetsFails = (status: number, body: unknown): Handler => (url) => (url.startsWith(ACCOUNT.token_uri) ? tokenOk : { status, body });

test("translates Google failures into actionable messages", async () => {
  assert.equal(await failureOf(() => ({ status: 400, body: { error: "invalid_grant", error_description: "Invalid JWT" } })), INVALID_GRANT_TEXT);
  assert.equal(await failureOf(sheetsFails(403, {
    error: { status: "PERMISSION_DENIED", message: "Google Sheets API has not been used in project 123", details: [{ reason: "SERVICE_DISABLED" }] },
  })), SERVICE_DISABLED_TEXT);
  assert.equal(await failureOf(sheetsFails(403, { error: { status: "PERMISSION_DENIED", message: "The caller does not have permission" } })),
    permissionDeniedText(ACCOUNT.client_email));
  assert.equal(await failureOf(sheetsFails(404, { error: { status: "NOT_FOUND" } })), NOT_FOUND_TEXT);
  assert.equal(await failureOf(sheetsFails(429, { error: { status: "RESOURCE_EXHAUSTED" } })), RATE_LIMIT_TEXT);
});

test("network errors and timeouts become a plain network message", async () => {
  const fetcher = (async () => { throw new DOMException("timed out", "TimeoutError"); }) as typeof fetch;
  await assert.rejects(new GoogleSheetsClient(ACCOUNT, { fetcher }).getAccessToken(),
    (error) => error instanceof GoogleSheetsError && error.message === NETWORK_ERROR_TEXT);
});

test("a corrupted private key is reported without calling Google", async () => {
  const { fetcher, calls } = fakeFetch(() => tokenOk);
  const client = new GoogleSheetsClient({ ...ACCOUNT, private_key: "-----BEGIN PRIVATE KEY-----\nbroken\n-----END PRIVATE KEY-----" }, { fetcher });
  await assert.rejects(client.getAccessToken(), (error) => error instanceof GoogleSheetsError && /private_key/.test(error.message));
  assert.equal(calls.length, 0);
});
