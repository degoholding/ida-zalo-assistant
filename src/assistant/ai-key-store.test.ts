import assert from "node:assert/strict";
import type http from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import { AiKeyProvider } from "../constants.js";
import { decryptJson, generateKey } from "../crypto/session-cipher.js";
import type { Db } from "../db/pool.js";
import { aiKeyRoutes } from "../web/api/ai-keys-api.js";
import type { ApiContext } from "../web/api/api-route.js";
import type { SyncService } from "../sync-service.js";
import { AiKeyStore, LEGACY_MIGRATION_ACTOR, parseAiKeyInput, parseAiKeyPatch, planLegacyKeyRows } from "./ai-key-store.js";

const ENCRYPTION_KEY = generateKey();
const NOW = Date.parse("2026-10-07T03:00:00Z");

interface Row {
  id: number; provider: number; base_url: string; model: string; model_heavy: string; secret: string; key_tail: string;
  priority: number; daily_cap: number; last_error: string; last_error_at: Date | null; verified_at: Date | null;
  deleted_at: Date | null; updated_by: string;
}

/** Bảng ai_key giả trong bộ nhớ — chỉ hiểu đúng các câu SQL kho Khóa AI dùng. Câu lạ thì ném lỗi để bài kiểm biết. */
function createFakeDb() {
  const rows: Row[] = [];
  const audit: unknown[][] = [];
  let nextId = 1;
  const query = async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim();
    if (text === "SELECT COUNT(*) AS n FROM ai_key") return [[{ n: rows.length }]];
    if (text.includes("FROM ai_key WHERE deleted_at IS NULL ORDER BY priority, id")) {
      return [rows.filter((row) => !row.deleted_at).sort((a, b) => a.priority - b.priority || a.id - b.id).map((row) => ({ ...row }))];
    }
    if (text.startsWith("SELECT ai_key_id, call_count FROM ai_key_usage")) return [[]];
    if (text.startsWith("SELECT COALESCE(MAX(priority), 0) AS p")) return [[{ p: Math.max(0, ...rows.filter((row) => !row.deleted_at).map((row) => row.priority)) }]];
    if (text.startsWith("INSERT INTO ai_key (")) {
      const migration = text.includes("VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)");
      const [provider, base_url, model, model_heavy, secret, key_tail, priority] = params as [number, string, string, string, string, string, number];
      const row: Row = {
        id: nextId++, provider, base_url, model, model_heavy, secret, key_tail, priority,
        daily_cap: migration ? 0 : Number(params[7]), last_error: "", last_error_at: null,
        verified_at: migration ? null : (params[8] as Date), deleted_at: null, updated_by: String(params[migration ? 7 : 9]),
      };
      rows.push(row);
      return [{ insertId: row.id, affectedRows: 1 }];
    }
    if (text.startsWith("UPDATE ai_key SET priority = CASE id")) {
      const [idA, prA, idB, prB] = params as number[];
      rows.find((row) => row.id === idA)!.priority = prA;
      rows.find((row) => row.id === idB)!.priority = prB;
      return [{ affectedRows: 2 }];
    }
    if (text.startsWith("UPDATE ai_key SET deleted_at")) {
      const row = rows.find((item) => item.id === params[2] && !item.deleted_at);
      if (row) row.deleted_at = params[0] as Date;
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (text.startsWith("UPDATE ai_key SET last_error")) {
      const row = rows.find((item) => item.id === params[2]);
      if (row) { row.last_error = String(params[0]); row.last_error_at = params[1] as Date; }
      return [{ affectedRows: 1 }];
    }
    const update = /^UPDATE ai_key SET (.+), updated_by = \? WHERE id = \? AND deleted_at IS NULL$/.exec(text);
    if (update) {
      const columns = update[1].split(", ").map((part) => part.replace(" = ?", "")) as (keyof Row)[];
      const row = rows.find((item) => item.id === params[columns.length + 1]);
      if (row) columns.forEach((column, index) => { (row as unknown as Record<string, unknown>)[column] = params[index]; });
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("INSERT INTO ai_key_usage")) return [{ affectedRows: 1 }];
    if (text.startsWith("INSERT INTO audit_log")) { audit.push(params); return [{ affectedRows: 1 }]; }
    throw new Error(`fake db: chưa hiểu câu SQL «${text}»`);
  };
  return { db: { query } as unknown as Db, rows, audit };
}

const LEGACY = {
  provider: "openai_then_gemini" as const,
  apiKey: "AIzaSyLEGACYGEMINIKEY0000gm12",
  openaiApiKey: "sk-modelapi-LEGACY-KEY-abcd",
  openaiBaseUrl: "https://modelapi.vn/v1",
  model: "gemini-3.5-flash-lite",
  heavyModel: "gemini-3.6-flash",
  openaiModel: "deepseek-v4.1-flash",
  openaiHeavyModel: "deepseek-v4.1-flash",
};

test("planLegacyKeyRows keeps the order in use: OpenAI-compatible station first, Gemini second", () => {
  const plan = planLegacyKeyRows(LEGACY);
  assert.deepEqual(plan.map((row) => [row.provider, row.baseUrl, row.model, row.modelHeavy]), [
    [AiKeyProvider.OpenAICompatible, "https://modelapi.vn/v1", "deepseek-v4.1-flash", ""],
    [AiKeyProvider.Gemini, "", "gemini-3.5-flash-lite", "gemini-3.6-flash"],
  ]);
});

test("planLegacyKeyRows: only the provider in use is copied; official OpenAI address becomes provider OpenAI", () => {
  assert.deepEqual(planLegacyKeyRows({ ...LEGACY, provider: "gemini" }).map((row) => row.provider), [AiKeyProvider.Gemini]);
  const openaiOnly = planLegacyKeyRows({ ...LEGACY, provider: "openai", openaiBaseUrl: "https://api.openai.com/v1/" });
  assert.deepEqual(openaiOnly.map((row) => [row.provider, row.baseUrl]), [[AiKeyProvider.OpenAI, ""]]);
  assert.deepEqual(planLegacyKeyRows({ ...LEGACY, apiKey: "", openaiApiKey: "" }), []);
  // Khóa «sk-…» dán nhầm ô Gemini được hiểu là khóa OpenAI như bot cũ — không chép thành dòng Gemini hỏng
  const misplaced = planLegacyKeyRows({ ...LEGACY, apiKey: "sk-proj-dan-nham-o-gemini", openaiApiKey: "" });
  assert.deepEqual(misplaced.map((row) => [row.provider, row.key]), [[AiKeyProvider.OpenAICompatible, "sk-proj-dan-nham-o-gemini"]]);
});

test("legacy migration runs once: copies encrypted rows when the table is empty, then never again", async () => {
  const { db, rows } = createFakeDb();
  const store = new AiKeyStore(db, ENCRYPTION_KEY, () => NOW);
  const copied = await store.migrateLegacyKeys(LEGACY);
  assert.equal(copied.length, 2);
  assert.deepEqual(rows.map((row) => [row.provider, row.priority, row.key_tail, row.updated_by]), [
    [AiKeyProvider.OpenAICompatible, 1, "abcd", LEGACY_MIGRATION_ACTOR],
    [AiKeyProvider.Gemini, 2, "gm12", LEGACY_MIGRATION_ACTOR],
  ]);
  assert.ok(!rows[0].secret.includes(LEGACY.openaiApiKey), "khóa lưu mã hóa, không để chữ thường");
  assert.equal(decryptJson<string>(rows[0].secret, ENCRYPTION_KEY), LEGACY.openaiApiKey);

  assert.deepEqual(await store.migrateLegacyKeys(LEGACY), [], "khởi động lần hai không chép thêm");
  assert.equal(rows.length, 2);

  // Quản trị gỡ hết khóa: bảng vẫn «đã từng có khóa» → không tự chép lại từ cài đặt cũ
  await store.load();
  for (const view of store.list()) await store.remove(view.id, "Quản trị");
  assert.equal(store.hasUsableKeys, false);
  assert.deepEqual(await store.migrateLegacyKeys(LEGACY), []);
});

test("migrated rows build a chain in the same order with each key's own model", async () => {
  const { db } = createFakeDb();
  const store = new AiKeyStore(db, ENCRYPTION_KEY, () => NOW);
  await store.migrateLegacyKeys(LEGACY);
  await store.load();
  const chain = store.buildChainKeys();
  assert.deepEqual(chain.map((key) => [key.model, key.heavyModel]), [["deepseek-v4.1-flash", ""], ["gemini-3.5-flash-lite", "gemini-3.6-flash"]]);
  assert.ok(chain.every((key) => !key.label.includes("LEGACY")), "nhãn log không chứa khóa");
});

test("a row encrypted with another SESSION_ENCRYPTION_KEY is shown as broken and left out of the chain", async () => {
  const { db } = createFakeDb();
  await new AiKeyStore(db, generateKey(), () => NOW).migrateLegacyKeys(LEGACY);
  const store = new AiKeyStore(db, ENCRYPTION_KEY, () => NOW);
  await store.load();
  assert.deepEqual(store.list().map((view) => view.broken), [true, true]);
  assert.deepEqual(store.buildChainKeys(), []);
  assert.equal(store.hasUsableKeys, false, "khóa hỏng hết thì bot quay về cài đặt cũ thay vì tắt");
});

test("moveUp swaps with the row above; the first row cannot move", async () => {
  const { db } = createFakeDb();
  const store = new AiKeyStore(db, ENCRYPTION_KEY, () => NOW);
  await store.migrateLegacyKeys(LEGACY);
  await store.load();
  const [first, second] = store.list();
  assert.equal(await store.moveUp(first.id, "Quản trị"), null);
  assert.equal(await store.moveUp(second.id, "Quản trị"), 1);
  assert.deepEqual(store.list().map((view) => view.id), [second.id, first.id]);
  assert.equal(await store.moveUp(999, "Quản trị"), null);
});

test("parseAiKeyInput rejects junk before any provider call", () => {
  assert.throws(() => parseAiKeyInput({ provider: 99, key: "x".repeat(30) }), /Chọn hãng/);
  assert.throws(() => parseAiKeyInput({ provider: "1; DROP TABLE", key: "x".repeat(30) }), /Chọn hãng/);
  assert.throws(() => parseAiKeyInput({ provider: AiKeyProvider.OpenAI, key: "" }), /Dán khóa/);
  assert.throws(() => parseAiKeyInput({ provider: AiKeyProvider.OpenAI, key: "sk-abc def ghi jkl" }), /không đúng dạng/);
  assert.throws(() => parseAiKeyInput({ provider: AiKeyProvider.OpenAI, key: "k".repeat(501) }), /không đúng dạng/);
  assert.throws(() => parseAiKeyInput({ provider: AiKeyProvider.OpenAICompatible, key: "x".repeat(30) }), /địa chỉ trạm/);
  assert.throws(() => parseAiKeyInput({ provider: AiKeyProvider.OpenAICompatible, key: "x".repeat(30), base_url: "http://169.254.169.254" }), /https/);
  assert.throws(() => parseAiKeyInput({ provider: AiKeyProvider.OpenAI, key: "x".repeat(30), model: "gpt 6; rm -rf" }), /Mô hình/);
  assert.throws(() => parseAiKeyInput({ provider: AiKeyProvider.OpenAI, key: "x".repeat(30), daily_cap: -1 }), /Trần/);
  assert.throws(() => parseAiKeyInput({ provider: AiKeyProvider.OpenAI, key: "x".repeat(30), daily_cap: 1.5 }), /Trần/);
  assert.throws(() => parseAiKeyPatch({ daily_cap: 10_000_001 }), /Trần/);
  // Hãng khác tùy chỉnh thì bỏ qua địa chỉ trạm gửi kèm (không cho trỏ hãng chuẩn đi chỗ khác)
  assert.equal(parseAiKeyInput({ provider: AiKeyProvider.OpenAI, key: "x".repeat(30), base_url: "https://evil.example.com" }).baseUrl, "");
  assert.deepEqual(parseAiKeyPatch({ model: " gpt-6-luna ", unknown: 1 }), { model: "gpt-6-luna" });
});

/** Gọi một tuyến API như máy chủ thật: thân JSON vào, phong bì JSON ra. */
async function callRoute(service: Partial<SyncService>, method: string, path: string, body?: unknown) {
  const route = aiKeyRoutes.find(([routeMethod, pattern]) => routeMethod === method && pattern.test(path));
  assert.ok(route, `không có tuyến ${method} ${path}`);
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as http.IncomingMessage;
  let status = 0;
  let payload = "";
  const response = {
    writeHead: (code: number) => { status = code; },
    end: (text: string) => { payload = text; },
  } as unknown as http.ServerResponse;
  await route[2]({ request, response, url: new URL(`http://x${path}`), match: route[1].exec(path)!, service: service as SyncService } as ApiContext);
  return { status, payload, json: JSON.parse(payload) as { data: Record<string, unknown>[]; message: string } };
}

test("API never returns the key: add, list, patch and audit only carry the last 4 characters", async () => {
  const { db, audit } = createFakeDb();
  const store = new AiKeyStore(db, ENCRYPTION_KEY, () => NOW);
  await store.load();
  let rebuilt = 0;
  const service = { aiKeys: store, db, applyAiKeys: () => { rebuilt += 1; } } as unknown as Partial<SyncService>;
  const rawKey = "sk-proj-SECRET-0123456789-TAIL";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ id: "gpt-6-luna" }] }), { status: 200 })) as typeof fetch;
  try {
    const added = await callRoute(service, "POST", "/api/ai-keys", { provider: AiKeyProvider.OpenAI, key: rawKey, daily_cap: 200 });
    assert.equal(added.status, 201);
    const listed = await callRoute(service, "GET", "/api/ai-keys");
    const patched = await callRoute(service, "PATCH", `/api/ai-keys/${String(listed.json.data[0].id)}`, { model: "gpt-6.1-sol" });
    for (const reply of [added, listed, patched]) {
      assert.ok(!reply.payload.includes(rawKey), "phản hồi không chứa khóa đầy đủ");
      assert.ok(!reply.payload.includes("SECRET"), "phản hồi không chứa mẩu nào của khóa ngoài đuôi");
      assert.ok(!reply.payload.includes("v1."), "phản hồi không chứa bản mã hóa");
      assert.ok(reply.json.data.every((item) => !("secret" in item)));
    }
    assert.equal(listed.json.data[0].key_tail, "…TAIL");
    assert.equal(listed.json.data[0].used_today, 0);
    assert.equal(rebuilt, 2, "thêm + sửa đều dựng lại trợ lý");
    assert.ok(!JSON.stringify(audit).includes("SECRET"), "nhật ký thao tác không ghi khóa");
    assert.match(JSON.stringify(audit), /thêm số 1 — OpenAI …TAIL/);

    // Thêm lại đúng khóa đó → báo trùng, không gọi hãng thêm dòng
    await assert.rejects(callRoute(service, "POST", "/api/ai-keys", { provider: AiKeyProvider.OpenAI, key: rawKey }), /đã có ở dòng số 1/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("API: a key the provider rejects is not saved and the error is a readable 422", async () => {
  const { db, rows } = createFakeDb();
  const store = new AiKeyStore(db, ENCRYPTION_KEY, () => NOW);
  await store.load();
  const service = { aiKeys: store, db, applyAiKeys: () => undefined } as unknown as Partial<SyncService>;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "Incorrect API key provided: sk-proj-***" } }), { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(callRoute(service, "POST", "/api/ai-keys", { provider: AiKeyProvider.OpenAI, key: "sk-proj-WRONG-KEY-000000" }),
      (error: { status?: number; message: string }) => error.status === 422 && /OpenAI không nhận khóa này/.test(error.message) && !error.message.includes("WRONG"));
    assert.equal(rows.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
