import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../web/api/api-http.js";
import { DEFAULT_TOKEN_URI, parseServiceAccount, parseSpreadsheetId } from "./service-account.js";

const VALID = {
  type: "service_account",
  project_id: "bot-tro-ly",
  client_email: "bot-tro-ly-sheets@bot-tro-ly.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----\n",
  token_uri: "https://oauth2.googleapis.com/token",
};
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

const rejects = (fn: () => unknown, pattern: RegExp) =>
  assert.throws(fn, (error) => error instanceof ApiError && error.status === 422 && pattern.test(error.message));

test("parses a service account from a JSON string or object", () => {
  assert.equal(parseServiceAccount(JSON.stringify(VALID)).client_email, VALID.client_email);
  assert.equal(parseServiceAccount(VALID).project_id, "bot-tro-ly");
});

test("defaults token_uri when missing", () => {
  const { token_uri: _ignored, ...withoutUri } = VALID;
  assert.equal(parseServiceAccount(withoutUri).token_uri, DEFAULT_TOKEN_URI);
});

test("restores escaped newlines in the private key", () => {
  const escaped = { ...VALID, private_key: "-----BEGIN PRIVATE KEY-----\\nMIIabc\\n-----END PRIVATE KEY-----\\n" };
  assert.equal(parseServiceAccount(escaped).private_key, VALID.private_key);
});

test("an OAuth client JSON pasted into the service account box points to the right box", () => {
  rejects(() => parseServiceAccount({ web: { client_id: "1.apps.googleusercontent.com", client_secret: "x" } }), /chỉ chép Client ID và Client secret/);
  rejects(() => parseServiceAccount({ installed: { client_id: "1.apps.googleusercontent.com" } }), /OAuth client/);
});

test("rejects broken JSON and wrong shapes with a clear reason", () => {
  rejects(() => parseServiceAccount("{not json"), /không phải JSON/);
  rejects(() => parseServiceAccount("[1,2]"), /object/);
  rejects(() => parseServiceAccount({ ...VALID, type: "authorized_user" }), /service_account/);
  rejects(() => parseServiceAccount({ ...VALID, client_email: "" }), /thiếu client_email/);
  rejects(() => parseServiceAccount({ ...VALID, client_email: "someone@gmail.com" }), /iam\.gserviceaccount\.com/);
  rejects(() => parseServiceAccount({ ...VALID, private_key: undefined }), /thiếu private_key/);
  rejects(() => parseServiceAccount({ ...VALID, private_key: "abc" }), /BEGIN PRIVATE KEY/);
});

test("extracts the spreadsheet id from links and bare ids", () => {
  assert.equal(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`), SHEET_ID);
  assert.equal(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${SHEET_ID}`), SHEET_ID);
  assert.equal(parseSpreadsheetId(` ${SHEET_ID} `), SHEET_ID);
});

test("rejects non-Sheets links, short ids and empty input", () => {
  rejects(() => parseSpreadsheetId(`https://docs.google.com/document/d/${SHEET_ID}/edit`), /không phải Google Sheets/);
  rejects(() => parseSpreadsheetId("abc123"), /không đúng/);
  rejects(() => parseSpreadsheetId("https://docs.google.com/spreadsheets/d/short/edit"), /không đúng/);
  rejects(() => parseSpreadsheetId(""), /Chưa có link/);
});
