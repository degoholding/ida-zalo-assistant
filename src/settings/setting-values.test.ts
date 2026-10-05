import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKey } from "../crypto/session-cipher.js";
import { findSetting, type SettingDefinition } from "./setting-registry.js";
import {
  BROKEN_SECRET_HINT,
  buildSettingView,
  decodeStoredValue,
  encodeStoredValue,
  sameSettingValue,
  type SettingState,
} from "./setting-values.js";

const setting = (key: string): SettingDefinition => findSetting(key)!;
const state = (patch: Partial<SettingState>): SettingState => ({ hasRow: false, webValue: null, broken: false, envValue: null, ...patch });

test("source is web when a row exists, env when only .env has it, otherwise default", () => {
  const definition = setting("assistant_max_per_hour");
  assert.equal(buildSettingView(definition, state({ hasRow: true, webValue: 40, envValue: 30 })).source, "web");
  assert.equal(buildSettingView(definition, state({ hasRow: true, webValue: 40, envValue: 30 })).value, 40);
  assert.equal(buildSettingView(definition, state({ envValue: 35 })).source, "env");
  assert.equal(buildSettingView(definition, state({ envValue: 35 })).value, 35);
  const fallback = buildSettingView(definition, state({}));
  assert.equal(fallback.source, "default");
  assert.equal(fallback.value, 30);
});

test("secret views never carry the value, only is_set and a hint", () => {
  const view = buildSettingView(setting("gemini_api_key"), state({ hasRow: true, webValue: "AIzaSECRETabcd" }));
  assert.equal(view.value, null);
  assert.equal(view.env_value, null);
  assert.equal(view.is_set, true);
  assert.equal(view.hint, "…abcd");
  assert.ok(!JSON.stringify(view).includes("SECRET"));

  const fromEnv = buildSettingView(setting("gemini_api_key"), state({ envValue: "envKEY9876" }));
  assert.equal(fromEnv.source, "env");
  assert.equal(fromEnv.env_value, null);
  assert.equal(fromEnv.hint, "…9876");

  const unset = buildSettingView(setting("gemini_api_key"), state({}));
  assert.equal(unset.is_set, false);
  assert.equal(unset.hint, "");
});

test("service account hint is the client email", () => {
  const account = { type: "service_account", client_email: "bot@demo.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nxx" };
  const view = buildSettingView(setting("google_service_account_json"), state({ hasRow: true, webValue: account }));
  assert.equal(view.hint, "bot@demo.iam.gserviceaccount.com");
  assert.ok(!JSON.stringify(view).includes("PRIVATE KEY"));
});

test("a secret that fails to decrypt counts as unset and asks to re-enter", () => {
  const view = buildSettingView(setting("gemini_api_key"), state({ hasRow: true, broken: true }));
  assert.equal(view.is_set, false);
  assert.equal(view.hint, BROKEN_SECRET_HINT);
  assert.equal(view.source, "web");
});

test("secrets round-trip through encryption and break safely with another key", () => {
  const key = generateKey();
  const definition = setting("gemini_api_key");
  const stored = encodeStoredValue(definition, "AIzaRoundTrip", key);
  assert.ok(stored.startsWith("v1.") && !stored.includes("AIzaRoundTrip"));
  assert.deepEqual(decodeStoredValue(stored, true, key), { ok: true, value: "AIzaRoundTrip" });
  assert.deepEqual(decodeStoredValue(stored, true, generateKey()), { ok: false });
  assert.deepEqual(decodeStoredValue("garbage", true, key), { ok: false });
});

test("plain values are stored as JSON", () => {
  const key = generateKey();
  const stored = encodeStoredValue(setting("gemini_fallback_models"), ["a", "b"], key);
  assert.equal(stored, '["a","b"]');
  assert.deepEqual(decodeStoredValue(stored, false, key), { ok: true, value: ["a", "b"] });
});

test("sameSettingValue compares by content", () => {
  assert.ok(sameSettingValue(30, 30));
  assert.ok(sameSettingValue(["a", "b"], ["a", "b"]));
  assert.ok(!sameSettingValue(["a", "b"], ["b", "a"]));
  assert.ok(!sameSettingValue(30, 40));
  assert.ok(!sameSettingValue(false, null));
});
