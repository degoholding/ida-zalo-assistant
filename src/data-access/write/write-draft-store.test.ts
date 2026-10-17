import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { McpCallSource } from "../../constants.js";
import { DataAccessError } from "../data-access-errors.js";
import { fakeDb, NOW } from "../data-access-test-support.js";
import {
  canonicalJson, CODE_ALPHABET, CODE_LENGTH, claimDraft, createDraft, DRAFT_TTL_MS, findOpenDraft, generateCode, hashCode, hashPayload,
  MAX_OPEN_DRAFTS_PER_USER, MAX_PROPOSALS_PER_MINUTE, normalizeCode,
} from "./write-draft-store.js";

// Phần thuần của kho nháp (mã, băm, ràng buộc trong câu SQL, trần) — không DB thật. Dùng một lần / hết hạn trên MySQL thật: test/mcp-write-confirm.integration.test.ts.

const binding = { tenantId: 1, userId: 7, keyId: 5 as number | null, source: McpCallSource.Http };

test("generateCode: 6 ký tự trong bảng chữ không nhầm lẫn (không 0 O 1 I L)", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateCode();
    assert.equal(code.length, CODE_LENGTH);
    assert.ok([...code].every((char) => CODE_ALPHABET.includes(char)), code);
  }
  assert.ok(!/[01OIL]/.test(CODE_ALPHABET));
  assert.equal(generateCode(() => 0), "222222");
});

test("hashCode: chuẩn hóa chữ hoa / khoảng trắng / gạch; băm hex 64, khác mã thì khác băm", () => {
  assert.equal(normalizeCode(" k7q-2mx "), "K7Q2MX");
  assert.equal(hashCode("k7q2mx"), hashCode("K7Q 2MX"));
  assert.match(hashCode("K7Q2MX"), /^[0-9a-f]{64}$/);
  assert.notEqual(hashCode("K7Q2MX"), hashCode("K7Q2MY"));
});

test("hashPayload: không phụ thuộc thứ tự khóa (MySQL JSON đổi thứ tự), nhưng đổi giá trị thì băm đổi", () => {
  const a = { args: { title: "x", due: "2026-10-20", nested: { b: 1, a: [1, 2] } }, state: "s" };
  const reordered = { state: "s", args: { nested: { a: [1, 2], b: 1 }, due: "2026-10-20", title: "x" } };
  assert.equal(hashPayload(a), hashPayload(reordered));
  assert.notEqual(hashPayload(a), hashPayload({ ...a, state: "s2" }));
  assert.notEqual(hashPayload(a), hashPayload({ ...a, args: { ...a.args, title: "y" } }));
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
});

test("findOpenDraft: câu SQL ràng buộc băm mã + người + khóa + nguồn + chưa dùng + chưa hết hạn; không dòng → null (một kết cục cho mọi ca sai)", async () => {
  const { db, queries } = fakeDb();
  assert.equal(await findOpenDraft(db, binding, "k7q2mx", NOW), null);
  const { sql, params } = queries[0];
  for (const fragment of ["code_hash = ?", "user_id = ?", "key_id <=> ?", "source = ?", "used_at IS NULL", "expires_at > ?"]) assert.ok(sql.includes(fragment), fragment);
  assert.deepEqual(params, [hashCode("K7Q2MX"), 1, 7, 5, McpCallSource.Http, NOW]);
});

test("claimDraft: dùng một lần — chỉ affectedRows = 1 mới thắng, câu SQL kèm used_at IS NULL + hết hạn", async () => {
  const sqls: string[] = [];
  const dbWith = (affectedRows: number) => ({ query: async (sql: string) => { sqls.push(sql); return [{ affectedRows }, []]; } }) as never;
  assert.equal(await claimDraft(dbWith(1), 9, NOW), true);
  assert.equal(await claimDraft(dbWith(0), 9, NOW), false);
  assert.match(sqls[0], /used_at IS NULL AND expires_at > \?/);
});

function countingDb(counts: { recent: number; open: number }, inserts: unknown[][] = []) {
  return { query: async (sql: string, params: unknown[]) => {
    if (sql.startsWith("SELECT COUNT(*)")) return [[{ n: sql.includes("created_at >") ? counts.recent : counts.open }], []];
    if (sql.startsWith("SELECT id")) return [[], []];
    inserts.push(params);
    return [{ insertId: 77 }, []];
  } } as never;
}
const newDraft = { ...binding, tool: "propose_task_create", targetEntity: "task", targetId: null, payload: { args: { title: "x" }, state: "new" }, preview: "p", now: NOW };

test("createDraft: lưu BĂM mã (không lưu mã gốc), TTL 10 phút, trả mã gốc một lần", async () => {
  const inserts: unknown[][] = [];
  const result = await createDraft(countingDb({ recent: 0, open: 0 }, inserts), newDraft);
  assert.equal(result.id, 77);
  assert.equal(result.expiresAt.getTime() - NOW.getTime(), DRAFT_TTL_MS);
  const row = inserts[0];
  assert.ok(!row.includes(result.code), "mã gốc không được vào DB");
  assert.ok(row.includes(hashCode(result.code)));
  assert.ok(row.includes(hashPayload(newDraft.payload)));
});

test("createDraft: vượt nhịp theo (người, khóa) hoặc vượt trần nháp mở → rate_limited, không INSERT", async () => {
  const inserts: unknown[][] = [];
  await assert.rejects(createDraft(countingDb({ recent: MAX_PROPOSALS_PER_MINUTE, open: 0 }, inserts), newDraft), (error: unknown) => error instanceof DataAccessError && error.code === "rate_limited");
  await assert.rejects(createDraft(countingDb({ recent: 0, open: MAX_OPEN_DRAFTS_PER_USER }, inserts), newDraft), (error: unknown) => error instanceof DataAccessError && error.code === "rate_limited");
  assert.equal(inserts.length, 0);
});

test("createDraft: trần nháp mở đếm theo (người, NGUỒN) — MCP chạy lung tung không chặn nháp của trợ lý", async () => {
  const sqls: { sql: string; params: unknown[] }[] = [];
  const db = { query: async (sql: string, params: unknown[]) => {
    sqls.push({ sql, params });
    return sql.startsWith("SELECT COUNT(*)") ? [[{ n: 0 }], []] : sql.startsWith("SELECT id") ? [[], []] : [{ insertId: 1 }, []];
  } } as never;
  await createDraft(db, { ...newDraft, source: McpCallSource.Assistant, keyId: null });
  const open = sqls.find((query) => query.sql.startsWith("SELECT COUNT(*)") && !query.sql.includes("created_at >"))!;
  assert.match(open.sql, /user_id = \? AND source = \?/);
  assert.deepEqual(open.params.slice(0, 2), [7, McpCallSource.Assistant]);
});

test("createDraft: nháp giống hệt vừa 'attempted' / 'failed' → invalid_state, không INSERT (M2)", async () => {
  const inserts: unknown[][] = [];
  const db = { query: async (sql: string, params: unknown[]) => {
    if (sql.startsWith("SELECT COUNT(*)")) return [[{ n: 0 }], []];
    if (sql.startsWith("SELECT id")) return [[{ id: 3 }], []];
    inserts.push(params);
    return [{ insertId: 1 }, []];
  } } as never;
  await assert.rejects(createDraft(db, newDraft), (error: unknown) => error instanceof DataAccessError && error.code === "invalid_state" && /lỗi giữa chừng/.test(error.message));
  assert.equal(inserts.length, 0);
});

test("băm là HMAC theo SESSION_ENCRYPTION_KEY: đổi khóa thì băm đổi; không phải SHA-256 trần (L: không dò ngược mã 6 ký tự)", () => {
  const previous = process.env.SESSION_ENCRYPTION_KEY;
  try {
    process.env.SESSION_ENCRYPTION_KEY = "khoa-thu-1";
    const one = hashCode("K7Q2MX");
    process.env.SESSION_ENCRYPTION_KEY = "khoa-thu-2";
    assert.notEqual(hashCode("K7Q2MX"), one);
    assert.notEqual(one, crypto.createHash("sha256").update("K7Q2MX").digest("hex"));
  } finally {
    if (previous === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
    else process.env.SESSION_ENCRYPTION_KEY = previous;
  }
});
