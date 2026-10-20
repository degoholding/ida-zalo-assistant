import assert from "node:assert/strict";
import { test } from "node:test";
import { DataAccessError } from "../data-access-errors.js";
import { fakeDb, makeCtx, manager } from "../data-access-test-support.js";
import { resolveGroupName, requireOneGroup } from "./group-name-resolver.js";
import { requireOnePerson, resolvePersonName } from "./person-name-resolver.js";

// Bộ phân giải tên người / nhóm (không DB thật): «DB» giả trả dòng tìm theo câu SQL. Khớp với `resolveAssignee` trên MySQL thật: test/assistant-contact-actor.integration.test.ts.

const personRow = (id: number, name: string, extra: Record<string, unknown> = {}) => ({ id, zalo_uid: `u-${id}`, name, kind: 2, exact: 0, in_group: 0, ...extra });

test("person: không ai → none; một người → one; bỏ xưng hô «anh» trước khi tìm", async () => {
  const none = fakeDb(() => []);
  assert.deepEqual(await resolvePersonName(none.db, "anh Nam"), { kind: "none", name: "Nam" });
  const one = fakeDb(() => [personRow(1, "Nam")]);
  const result = await resolvePersonName(one.db, "anh Nam");
  assert.equal(result.kind, "one");
  assert.ok(result.kind === "one" && result.contact.id === 1);
  assert.equal(one.queries[0].params[0], "Nam");
});

test("person: nhiều người → ưu tiên thành viên nhóm, rồi khớp đúng tên; vẫn mơ hồ → many kèm danh sách", async () => {
  const inGroupOnly = fakeDb(() => [personRow(1, "Minh A", { in_group: 1 }), personRow(2, "Minh B")]);
  assert.equal((await resolvePersonName(inGroupOnly.db, "Minh", { groupId: 5 })).kind, "one", "chỉ một người ở nhóm");
  const exactOnly = fakeDb(() => [personRow(1, "Minh", { exact: 1 }), personRow(2, "Minh Hải")]);
  const exact = await resolvePersonName(exactOnly.db, "Minh");
  assert.ok(exact.kind === "one" && exact.contact.id === 1);
  const many = fakeDb(() => [personRow(1, "Minh A"), personRow(2, "Minh B")]);
  const ambiguous = await resolvePersonName(many.db, "Minh");
  assert.ok(ambiguous.kind === "many" && ambiguous.choices.length === 2);
});

test("person: scope (MCP ngoài) đi vào câu SQL đúng thứ tự tham số; không scope thì SQL không đổi", async () => {
  const scoped = fakeDb(() => []);
  await resolvePersonName(scoped.db, "Nam", { scope: { sql: "c.id IN (?)", params: [[7, 8]] }, limit: 3 });
  assert.match(scoped.queries[0].sql, /AND c\.id IN \(\?\)/);
  assert.deepEqual(scoped.queries[0].params.slice(-2), [[[7, 8]][0], 3]);
  const plain = fakeDb(() => []);
  await resolvePersonName(plain.db, "Nam");
  assert.ok(!/c\.id IN \(\?\)/.test(plain.queries[0].sql));
});

test("requireOnePerson: not_found / ambiguous (kèm choices, câu mô tả cũ) / một người", async () => {
  const code = async (db: ReturnType<typeof fakeDb>["db"]) => {
    try { await requireOnePerson(db, "Minh", "giao <tên>: <việc>"); return { code: "ok" } as const; } catch (error) { return error as DataAccessError; }
  };
  assert.equal(((await code(fakeDb(() => []).db)) as DataAccessError).code, "not_found");
  const ambiguous = (await code(fakeDb(() => [personRow(1, "Minh A"), personRow(2, "Minh B")]).db)) as DataAccessError;
  assert.equal(ambiguous.code, "ambiguous");
  assert.deepEqual(ambiguous.detail?.choices?.map((choice) => choice.id), [1, 2]);
  assert.match(ambiguous.message, /Có 2 người khớp «Minh»/);
  assert.deepEqual(await code(fakeDb(() => [personRow(1, "Minh")]).db), { code: "ok" });
});

const groupRow = (id: number, shown: string, exact = 0) => ({ id, shown, exact });

test("group: qua threadVisibilitySql (phạm vi nhóm + Mật), khớp tên hoặc nhãn; một nhóm → one", async () => {
  const sim = fakeDb(() => [groupRow(11, "K52")]);
  const result = await resolveGroupName(makeCtx(manager({ groupIds: [11, 12] }), {}, sim.db), "k52");
  assert.ok(result.kind === "one" && result.group.id === 11);
  assert.match(sim.queries[0].sql, /g\.name LIKE \? OR g\.label LIKE \?/);
  assert.match(sim.queries[0].sql, /is_confidential = 0/, "người chưa có cờ Mật không thấy nhóm Mật");
});

test("group: nhiều nhóm → khớp đúng tên thắng, còn lại many; không nhóm nào → none", async () => {
  const exact = fakeDb(() => [groupRow(1, "Kho", 1), groupRow(2, "Kho Cần Thơ")]);
  assert.ok((await resolveGroupName(makeCtx(manager(), {}, exact.db), "Kho")).kind === "one");
  const many = fakeDb(() => [groupRow(1, "Kho A"), groupRow(2, "Kho B")]);
  const ambiguous = await resolveGroupName(makeCtx(manager(), {}, many.db), "Kho");
  assert.ok(ambiguous.kind === "many" && ambiguous.choices.length === 2);
  assert.equal((await resolveGroupName(makeCtx(manager(), {}, fakeDb().db), "Không có")).kind, "none");
  assert.equal((await resolveGroupName(makeCtx(manager(), {}, fakeDb().db), "   ")).kind, "none");
});

test("group: chỉ nhóm Mật khớp mà người hỏi chưa có cờ → confidential (khác none); có cờ rồi thì one", async () => {
  // Lần 1 (không Mật): không dòng. Lần 2 (nới Mật): có dòng — nhận biết qua câu SQL không còn «is_confidential = 0»
  const sim = fakeDb((sql) => (/is_confidential = 0/.test(sql) ? [] : [groupRow(9, "Ban giám đốc")]));
  const blocked = await resolveGroupName(makeCtx(manager(), { includeConfidential: false }, sim.db), "ban giám đốc");
  assert.deepEqual(blocked, { kind: "confidential", name: "ban giám đốc" });
  await assert.rejects(requireOneGroup(makeCtx(manager(), { includeConfidential: false }, sim.db), "ban giám đốc"), (error: unknown) => error instanceof DataAccessError && error.code === "confidential");
  const allowed = await resolveGroupName(makeCtx(manager(), { includeConfidential: true }, sim.db), "ban giám đốc");
  assert.equal(allowed.kind, "one");
});

test("requireOneGroup: ambiguous kèm choices; not_found", async () => {
  const many = fakeDb(() => [groupRow(1, "Kho A"), groupRow(2, "Kho B")]);
  await assert.rejects(requireOneGroup(makeCtx(manager(), {}, many.db), "Kho"), (error: unknown) =>
    error instanceof DataAccessError && error.code === "ambiguous" && error.detail?.choices?.length === 2);
  await assert.rejects(requireOneGroup(makeCtx(manager(), {}, fakeDb().db), "xyz"), (error: unknown) => error instanceof DataAccessError && error.code === "not_found");
});
