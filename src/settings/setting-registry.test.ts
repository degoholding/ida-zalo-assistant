import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ApiError } from "../web/api/api-http.js";
import { parseSettingInput, readEnvValue } from "./setting-input-parser.js";
import { SETTING_DEFINITIONS, findSetting, type SettingDefinition } from "./setting-registry.js";

const setting = (key: string): SettingDefinition => {
  const definition = findSetting(key);
  assert.ok(definition, `thiếu khóa ${key}`);
  return definition;
};

const rejects = (key: string, raw: unknown) =>
  assert.throws(() => parseSettingInput(setting(key), raw), (error) => error instanceof ApiError && error.status === 422, `${key}=${JSON.stringify(raw)}`);

test("int settings accept numbers and numeric strings within range", () => {
  assert.equal(parseSettingInput(setting("assistant_max_per_hour"), 30), 30);
  assert.equal(parseSettingInput(setting("assistant_max_per_hour"), " 40 "), 40);
  assert.equal(parseSettingInput(setting("max_file_mb"), "500"), 500);
});

test("int settings reject empty, negative, zero, out of range, decimals and words", () => {
  for (const raw of ["", -1, 0, 1001, 5000, 30.5, "30.5", "abc", null, true, [30]]) rejects("assistant_max_per_hour", raw);
  rejects("assistant_send_interval_ms", 499);
  rejects("assistant_daily_token_cap", 9_999);
});

test("bool settings accept only true / false", () => {
  assert.equal(parseSettingInput(setting("default_group_read"), true), true);
  assert.equal(parseSettingInput(setting("default_group_read"), false), false);
  for (const raw of ["có", "true", 1, null]) rejects("default_group_read", raw);
});

test("model names must be lowercase letters, digits, dots and dashes", () => {
  assert.equal(parseSettingInput(setting("gemini_model"), " gemini-3.5-flash "), "gemini-3.5-flash");
  for (const raw of ["", "gemini flash", "Gemini-3", "ab", "gemini_3", "x".repeat(81), 12]) rejects("gemini_model", raw);
  // Mô hình nặng được để trống = dùng mô hình chính
  assert.equal(parseSettingInput(setting("gemini_model_heavy"), ""), "");
});

test("list settings accept arrays or comma strings, drop blanks and duplicates", () => {
  const definition = setting("gemini_fallback_models");
  assert.deepEqual(parseSettingInput(definition, "a-1, b-2,,a-1 "), ["a-1", "b-2"]);
  assert.deepEqual(parseSettingInput(definition, ["abc", " def "]), ["abc", "def"]);
  rejects("gemini_fallback_models", ["m-1", "m-2", "m-3", "m-4", "m-5", "m-6"]);
  rejects("gemini_fallback_models", "ok-model, bad model");
  rejects("gemini_fallback_models", [1, 2]);
});

test("gemini api key rejects whitespace and overlong values", () => {
  assert.equal(parseSettingInput(setting("gemini_api_key"), " AIzaTest123 "), "AIzaTest123");
  rejects("gemini_api_key", "abc def");
  rejects("gemini_api_key", "x".repeat(201));
});

test("spreadsheet url must point at Google Sheets", () => {
  const url = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0";
  assert.equal(parseSettingInput(setting("google_spreadsheet_url"), url), url);
  assert.equal(parseSettingInput(setting("google_spreadsheet_url"), ""), "");
  rejects("google_spreadsheet_url", "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit");
  rejects("google_spreadsheet_url", "short-id");
});

test("readEnvValue parses like config.ts and treats blank as unset", () => {
  const env = { ASSISTANT_MAX_PER_HOUR: "45", DEFAULT_GROUP_READ: "on", GEMINI_FALLBACK_MODELS: "a, b,", GEMINI_API_KEY: " key ", GEMINI_MODEL: "" };
  assert.equal(readEnvValue(setting("assistant_max_per_hour"), env), 45);
  assert.equal(readEnvValue(setting("default_group_read"), env), true);
  assert.deepEqual(readEnvValue(setting("gemini_fallback_models"), env), ["a", "b"]);
  assert.equal(readEnvValue(setting("gemini_api_key"), env), "key");
  assert.equal(readEnvValue(setting("gemini_model"), env), null);
  assert.equal(readEnvValue(setting("google_spreadsheet_url"), env), null);
});

test("defaults pass their own validation", () => {
  for (const definition of SETTING_DEFINITIONS) {
    if (definition.secret || definition.defaultValue === null || definition.defaultValue === "") continue;
    assert.deepEqual(parseSettingInput(definition, definition.defaultValue), definition.defaultValue, definition.key);
  }
});

// Canh: đổi tên biến ở một bên (registry hoặc .env.example) là bài kiểm đỏ
test("every envName in the registry is documented in .env.example", () => {
  const example = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  for (const definition of SETTING_DEFINITIONS) {
    if (!definition.envName) continue;
    assert.match(example, new RegExp(`^${definition.envName}=`, "m"), `${definition.envName} thiếu trong .env.example`);
  }
});

// 06/10/2026: loại tệp đọc được chọn bằng ô tick — chỉ nhận đuôi có trong danh sách chọn
test("readable file types accept only listed extensions, normalised", () => {
  const definition = setting("assistant_readable_file_types");
  assert.ok(definition.choices?.some((choice) => choice.value === "mp3"));
  assert.ok(!definition.choices?.some((choice) => choice.value === "mp4"));
  assert.deepEqual(parseSettingInput(definition, ".PDF, mp3, pdf"), ["pdf", "mp3"]);
  assert.deepEqual(parseSettingInput(definition, ""), []);
  rejects("assistant_readable_file_types", "pdf, mp4");
  rejects("assistant_readable_file_types", ["exe"]);
});

// 06/10/2026: «Kết nối Google» chỉ cần chép Client ID + Client secret (không dán tệp JSON)
test("Google OAuth boxes accept the copied Client ID and secret, and reject a pasted JSON file", () => {
  assert.equal(parseSettingInput(setting("google_oauth_client_id"), " 1264-0sdak.apps.googleusercontent.com "), "1264-0sdak.apps.googleusercontent.com");
  assert.equal(parseSettingInput(setting("google_oauth_client_secret"), " GOCSPX-abc "), "GOCSPX-abc");
  rejects("google_oauth_client_id", '{"web":{"client_id":"1.apps.googleusercontent.com"}}');
  rejects("google_oauth_client_id", "GOCSPX-abc");
  rejects("google_oauth_client_secret", "có khoảng trắng");
});
