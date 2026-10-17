import assert from "node:assert/strict";
import { test } from "node:test";
import { DataAccessError } from "./data-access-errors.js";
import { admin, fakeDb, makeCtx, staff } from "./data-access-test-support.js";
import {
  andParts, assertAttachmentReadable, assertMessageReadable, assertThreadReadable, groupVisibilitySql, sourceThreadVisibilitySql, threadVisibilitySql,
} from "./visibility-guards.js";

const adminNoMat = makeCtx(admin());
const adminMat = makeCtx(admin({ canViewConfidential: true }));
const scoped = makeCtx(staff());
const scopedMat = makeCtx(staff({ canViewConfidential: true }));
const empty = makeCtx(staff({ groupIds: [] }));

test("threadVisibilitySql: cuộc riêng hoặc nhóm bật «Đọc tin», phạm vi nhóm, Mật", () => {
  assert.deepEqual(threadVisibilitySql(adminNoMat, "g"), { sql: "(g.thread_type = 0 OR g.read_messages = 1) AND g.is_confidential = 0", params: [] });
  assert.deepEqual(threadVisibilitySql(adminMat, "g"), { sql: "(g.thread_type = 0 OR g.read_messages = 1) AND 1 = 1", params: [] });
  assert.deepEqual(threadVisibilitySql(scoped, "g"), { sql: "(g.thread_type = 0 OR g.read_messages = 1) AND g.id IN (?) AND g.is_confidential = 0", params: [[11, 12]] });
  assert.deepEqual(threadVisibilitySql(scopedMat, "x"), { sql: "(x.thread_type = 0 OR x.read_messages = 1) AND x.id IN (?)", params: [[11, 12]] });
});

test("danh sách nhóm rỗng → không thấy gì (1 = 0), dù có cờ Mật", () => {
  assert.match(threadVisibilitySql(empty, "g").sql, /1 = 0/);
  assert.match(groupVisibilitySql(makeCtx(staff({ groupIds: [], canViewConfidential: true })), "g.id", "g.is_confidential").sql, /1 = 0/);
});

test("quản trị KHÔNG tự thấy nhóm Mật: cần cờ riêng", () => {
  assert.match(groupVisibilitySql(adminNoMat, "g.id", "g.is_confidential").sql, /g\.is_confidential = 0/);
  assert.doesNotMatch(groupVisibilitySql(adminMat, "g.id", "g.is_confidential").sql, /is_confidential/);
});

test("sourceThreadVisibilitySql: khoanh phạm vi theo nhóm nguồn; không Mật → bỏ nhóm Mật; quản trị + Mật → không điều kiện", () => {
  assert.deepEqual(sourceThreadVisibilitySql(scoped, "t.source_thread_id", "g"), {
    sql: "t.source_thread_id IN (?) AND (g.id IS NULL OR g.is_confidential = 0)", params: [[11, 12]],
  });
  assert.deepEqual(sourceThreadVisibilitySql(adminNoMat, "t.source_thread_id", "g"), { sql: "(g.id IS NULL OR g.is_confidential = 0)", params: [] });
  assert.equal(sourceThreadVisibilitySql(adminMat, "t.source_thread_id", "g"), undefined);
  assert.match(sourceThreadVisibilitySql(empty, "t.source_thread_id", "g")!.sql, /1 = 0/);
});

test("andParts: bỏ phần trống, bọc ngoặc, nối tham số theo thứ tự", () => {
  assert.equal(andParts(undefined, undefined), undefined);
  assert.deepEqual(andParts({ sql: "a = ?", params: [1] }, undefined, { sql: "b = ? OR c = ?", params: [2, 3] }), { sql: "(a = ?) AND (b = ? OR c = ?)", params: [1, 2, 3] });
});

test("assertThreadReadable: không thấy → not_found (không lộ «có mà không được xem»); thấy → qua; câu SQL mang đủ điều kiện", async () => {
  const hidden = fakeDb(() => []);
  await assert.rejects(() => assertThreadReadable(makeCtx(staff(), {}, hidden.db), 99), (error: unknown) => error instanceof DataAccessError && error.code === "not_found");
  assert.match(hidden.queries[0].sql, /FROM zalo_group g WHERE g\.id = \? AND \(g\.thread_type = 0 OR g\.read_messages = 1\) AND g\.id IN \(\?\) AND g\.is_confidential = 0 LIMIT 1/);
  assert.deepEqual(hidden.queries[0].params, [99, [11, 12]]);
  const visible = fakeDb(() => [{ ok: 1 }]);
  await assertThreadReadable(makeCtx(staff(), {}, visible.db), 11);
});

test("assertAttachmentReadable / assertMessageReadable: nối qua nhóm chứa tệp / tin, cùng điều kiện", async () => {
  const none = fakeDb(() => []);
  const ctx = makeCtx(staff(), {}, none.db);
  await assert.rejects(() => assertAttachmentReadable(ctx, 5), (error: unknown) => error instanceof DataAccessError && error.code === "not_found");
  await assert.rejects(() => assertMessageReadable(ctx, 6), (error: unknown) => error instanceof DataAccessError && error.code === "not_found");
  assert.match(none.queries[0].sql, /FROM attachment a JOIN zalo_group g ON g\.id = a\.group_id JOIN message m ON m\.id = a\.message_id\s+WHERE a\.id = \? AND m\.recalled_at IS NULL AND .*g\.is_confidential = 0/);
  assert.match(none.queries[1].sql, /FROM message m JOIN zalo_group g ON g\.id = m\.group_id WHERE m\.id = \? AND m\.recalled_at IS NULL AND .*g\.is_confidential = 0/);
});
