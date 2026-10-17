import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTACT_LIST_SPEC } from "../web/api/contacts-api.js";
import { buildConditionFromValues } from "../web/api/list-query.js";
import { admin, compileRows as compile, fakeDb, makeCtx, manager, rejects, staff } from "./data-access-test-support.js";
import { findTool } from "./read-tool-catalog.js";
import { shapeRows } from "./result-envelope.js";
import { compileQuery } from "./query-compiler.js";
import { findEntity } from "./entity-registry.js";
import { runTool } from "./tool-runner.js";
import { assertAttachmentReadable, assertThreadReadable, directThreadSql, threadVisibilitySql } from "./visibility-guards.js";

// Hồi quy review phase 2 (không cần DB): M1 / M2 / M3 / M4 / L1 / L2 / L3 / L6 / H2-L7. H1 / L4 / M1 / L3 / H2 trên MySQL thật:
// review-fixes.integration.test.ts.

const tool = (name: string) => findTool(name)!;
const masked = (principal = admin()) => makeCtx(principal, { maskPersonal: true });

test("M1: lọc contacts.group_id giao với phạm vi + bỏ nhóm Mật; id ngoài phạm vi → không khớp ai", () => {
  const out = compile("contacts", { filters: [{ field: "group_id", op: "eq", value: 999 }] }, makeCtx(staff()));
  assert.match(out.sql, /\(1 = 0\)/, "nhóm 999 ngoài phạm vi [11, 12]");
  assert.ok(!out.params.some((param) => Array.isArray(param) && param.includes(999)));
  const inScope = compile("contacts", { filters: [{ field: "group_id", op: "in", value: [11, 999] }] }, makeCtx(staff()));
  assert.ok(inScope.params.some((param) => Array.isArray(param) && param.join() === "11"));
  assert.match(inScope.sql, /JOIN zalo_group zg ON zg\.id = gm\.group_id[\s\S]*zg\.is_confidential = 0/);
  // «không ở nhóm X» với X ngoài phạm vi: đúng với mọi người, không lộ ai ở X
  assert.match(compile("contacts", { filters: [{ field: "group_id", op: "ne", value: 999 }] }, makeCtx(staff())).sql, /\(1 = 1\)/);
  // Có cờ Mật + mọi nhóm: giữ nguyên (không JOIN zalo_group)
  const open = compile("contacts", { filters: [{ field: "group_id", op: "eq", value: 999 }] }, makeCtx(admin({ canViewConfidential: true })));
  assert.doesNotMatch(open.sql, /zg\.is_confidential/);
  assert.ok(open.params.some((param) => Array.isArray(param) && param.join() === "999"));
});

test("M1: group_count chỉ đếm nhóm thấy được (phạm vi + không Mật); có Mật + mọi nhóm thì đếm hết", () => {
  const scoped = compile("contacts", { fields: ["id", "group_count"] }, makeCtx(staff()));
  assert.match(scoped.sql, /JOIN zalo_group zg ON zg\.id = gm\.group_id WHERE gm\.zalo_uid = c\.zalo_uid AND gm\.left_at IS NULL AND gm\.group_id IN \(11,12\) AND zg\.is_confidential = 0\) AS `group_count`/);
  const open = compile("contacts", { fields: ["group_count"] }, makeCtx(admin({ canViewConfidential: true })));
  assert.doesNotMatch(open.sql, /is_confidential|group_id IN/);
  assert.match(compile("contacts", { fields: ["group_count"] }, makeCtx(staff({ groupIds: [] }))).sql, /AND 1 = 0 AND/);
  const aggregate = compileQuery(findEntity("contacts")!, makeCtx(admin()), { entity: "contacts", aggregate: { fn: "count", group_by: [{ field: "kind" }] } });
  assert.equal(aggregate.kind, "aggregate");
});

test("M2: bật che dữ liệu cá nhân → không lọc / tìm theo SĐT (contacts, catalog), vẫn lọc được khi tắt che", () => {
  rejects(() => compile("contacts", { filters: [{ field: "phone", op: "contains", value: "abc" }] }, masked()), "invalid_field", /phone/);
  assert.doesNotThrow(() => compile("contacts", { filters: [{ field: "phone", op: "contains", value: "abc" }] }, makeCtx(admin())));
  const search = compile("contacts", { search: "lan" }, masked());
  assert.doesNotMatch(search.sql, /c\.phone LIKE/);
  assert.match(compile("contacts", { search: "lan" }, makeCtx(admin())).sql, /c\.phone LIKE/);
  assert.doesNotMatch(compile("catalog", { search: "lan" }, masked()).sql, /e\.phone LIKE/);
  assert.match(compile("catalog", { search: "lan" }, makeCtx(admin())).sql, /e\.phone LIKE/);
});

test("M2: bật che → từ chối contains / search có dãy ≥ 4 chữ số (chống dò SĐT); tắt che thì cho; eq theo mã không bị chặn", () => {
  const byThread = { field: "thread_id", op: "eq" as const, value: 12 };
  for (const value of ["0912", "09 12 34", "0912.345", "+84 912"]) {
    rejects(() => compile("messages", { filters: [byThread, { field: "text", op: "contains", value }] }, masked()), "invalid_value", /che dữ liệu/);
  }
  rejects(() => compile("messages", { filters: [byThread], search: "0912" }, masked()), "invalid_value");
  rejects(() => compile("files", { search: "0912345678" }, masked()), "invalid_value");
  assert.doesNotThrow(() => compile("messages", { filters: [byThread, { field: "text", op: "contains", value: "báo giá 123" }] }, masked()));
  assert.doesNotThrow(() => compile("messages", { filters: [byThread, { field: "text", op: "contains", value: "0912" }] }, makeCtx(admin())));
  assert.doesNotThrow(() => compile("messages", { filters: [byThread, { field: "sender_uid", op: "eq", value: "1234567890" }] }, masked()));
});

test("M2: search_messages bật che → từ chối từ khóa toàn số; đoạn trích che TRƯỚC khi cắt (L1)", async () => {
  const ctx = masked();
  assert.equal((await runTool(tool("search_messages"), ctx, { query: "0912345" })).errorCode, "invalid_value");
  const long = `${"x".repeat(85)} 0912345678 gọi giúp`;
  const { db, queries } = fakeDb((sql) => (sql.includes("FROM message_search") ? [{ id: 5, group_id: 12, thread_name: "KD", sender_name: "Huy", sent_at: new Date("2026-10-16T02:00:00Z"), text: long }] : []));
  const result = await runTool(tool("search_messages"), makeCtx(admin(), { maskPersonal: true }, db), { query: "gọi" });
  const snippet = (result.structured as { hits: { snippet: string }[] }).hits[0].snippet;
  assert.doesNotMatch(snippet, /0912345/);
  assert.match(snippet, /\[SĐT \*\*\*678\]/);
  assert.ok(queries.length > 0);
});

test("M3: contains thoát % _ trong DSL; thẻ (tag) contains cũng thoát", () => {
  const out = compile("groups", { filters: [{ field: "name", op: "contains", value: "50%_x" }] });
  assert.ok(out.params.includes("%50\\%\\_x%"));
  const tag = CONTACT_LIST_SPEC.fields.tag;
  assert.deepEqual(buildConditionFromValues(tag, "contains", ["v%p_"]), { sql: "EXISTS (SELECT 1 FROM contact_tag t WHERE t.contact_id = c.id AND t.tag LIKE ?)", params: ["%v\\%p\\_%"] });
});

test("M4: mọi cột tên lấy từ Zalo / người ngoài được đánh dấu untrusted", () => {
  const expected: Record<string, string[]> = {
    messages: ["thread_name", "sender_name", "text", "quote_text"], files: ["file_name", "thread_name", "sender_name"],
    groups: ["name", "label"], conversations: ["name", "label", "last_text"], contacts: ["display_name", "zalo_name", "note"],
    tickets: ["requester_name", "handler_name", "source_thread_name"], tasks: ["assignee_name", "assigner_name", "source_thread_name"],
    send_commands: ["requester_name"], audit_log: ["changed_fields"],
  };
  for (const [entity, columns] of Object.entries(expected)) {
    const def = findEntity(entity)!;
    for (const column of columns) assert.equal(def.columns[column].untrusted, true, `${entity}.${column}`);
  }
});

test("L1: shapeRows che SĐT trước khi cắt ô (số nằm sát chỗ cắt không lọt)", () => {
  const def = findEntity("messages")!;
  const compiled = compile("messages", { fields: ["id", "text"], filters: [{ field: "thread_id", op: "eq", value: 1 }] });
  const text = `${"a".repeat(1990)} 0912345678 hết`;
  const plain = shapeRows(def, compiled, [{ id: 1, text }] as never, null, false).items[0].text as string;
  assert.match(plain, /0912345/, "không che thì giữ nguyên (cắt tại ô 2 000)");
  const safe = shapeRows(def, compiled, [{ id: 1, text }] as never, null, true).items[0].text as string;
  assert.doesNotMatch(safe, /0912345/);
  assert.match(safe, /\[SĐT/);
});

test("L1: get_thread_messages che trước khi cắt tin 4 000 ký tự", async () => {
  const text = `${"b".repeat(3995)} 0912345678`;
  const { db } = fakeDb((sql) => (/FROM zalo_group g WHERE g\.id = \?/.test(sql) ? [{ ok: 1 }] : [{ id: 1, sent_at: new Date("2026-10-16T03:00:00Z"), sender_uid: "u", sender_name: "A", kind: 0, text, quote_text: null, attachment_id: null, file_name: null }]));
  const result = await runTool(tool("get_thread_messages"), makeCtx(admin(), { maskPersonal: true }, db), { thread_id: 12 });
  const item = (result.structured as { items: { text: string }[] }).items[0];
  assert.doesNotMatch(item.text, /0912345/);
  assert.match(item.text, /\[SĐT/);
  assert.ok((result.structured as { untrusted_fields: string[] }).untrusted_fields.includes("sender_name"));
});

test("L2: chốt chặn / get_thread_messages / get_file_text có MAX_EXECUTION_TIME; hết giờ → timeout", async () => {
  const ctx = makeCtx(staff(), {}, fakeDb(() => [{ ok: 1 }]).db);
  const { db, queries } = fakeDb(() => [{ ok: 1 }]);
  await assertThreadReadable(makeCtx(staff(), {}, db), 12);
  await assertAttachmentReadable(makeCtx(staff(), {}, db), 5);
  for (const query of queries) assert.match(query.sql, /^SELECT \/\*\+ MAX_EXECUTION_TIME\(5000\) \*\/ 1 FROM/);
  const guarded = fakeDb((sql) => (/FROM zalo_group g WHERE g\.id = \?|FROM attachment a/.test(sql) ? [{ ok: 1 }] : [{ file_name: "a", method: "text", total: 1, chunk: "x" }]));
  await runTool(tool("get_file_text"), makeCtx(admin(), {}, guarded.db), { attachment_id: 5 });
  assert.match(guarded.queries.at(-1)!.sql, /SELECT \/\*\+ MAX_EXECUTION_TIME\(5000\) \*\/ a\.file_name/);
  await runTool(tool("get_thread_messages"), makeCtx(admin(), {}, guarded.db), { thread_id: 12 });
  assert.match(guarded.queries.at(-1)!.sql, /SELECT \/\*\+ MAX_EXECUTION_TIME\(5000\) \*\/ m\.id/);
  const slow = { query: async () => { throw Object.assign(new Error("x"), { errno: 3024 }); } };
  await assert.rejects(() => assertThreadReadable(makeCtx(staff(), {}, slow as never), 12), (error: unknown) => (error as { code?: string }).code === "timeout");
  assert.ok(ctx);
});

test("L3: tệp của tin đã thu hồi ẩn khỏi files và get_file_text", async () => {
  assert.match(compile("files", {}, makeCtx(admin())).sql, /m\.recalled_at IS NULL/);
  const { db, queries } = fakeDb(() => []);
  await assert.rejects(() => assertAttachmentReadable(makeCtx(admin(), {}, db), 5), (error: unknown) => (error as { code?: string }).code === "not_found");
  assert.match(queries[0].sql, /JOIN message m ON m\.id = a\.message_id[\s\S]*m\.recalled_at IS NULL/);
});

test("L6: metrics_summary từ chối khi có nguồn số liệu của tenant khác (không lẫn số liệu)", async () => {
  const input = { metrics: ["ban_hang"], from: "2026-10-01", to: "2026-10-02" };
  const foreign = fakeDb((sql) => (sql.includes("FROM metric_source s WHERE s.is_active = 1 AND s.tenant_id <> ?") ? [{ one: 1 }] : []));
  const result = await runTool(tool("metrics_summary"), makeCtx(manager(), {}, foreign.db), input);
  assert.equal(result.errorCode, "forbidden");
  assert.deepEqual(foreign.queries[0].params, [1]);
  assert.equal(foreign.queries.length, 1, "không chạy buildSummary");
});

test("H2 / L7: ownDirectThreadsOnly — cuộc riêng chỉ của mình, cờ read_messages không mở cuộc riêng người khác", () => {
  const everyone = makeCtx(admin());
  assert.deepEqual(directThreadSql(everyone, "g"), { sql: "g.thread_type = 0", params: [] });
  const own = makeCtx(admin(), { ownDirectThreadsOnly: true, ownDirectUid: "u-sep" });
  assert.deepEqual(directThreadSql(own, "g"), { sql: "(g.thread_type = 0 AND g.zalo_group_id = ?)", params: ["u-sep"] });
  assert.deepEqual(threadVisibilitySql(own, "g"), {
    sql: "((g.thread_type = 0 AND g.zalo_group_id = ?) OR (g.thread_type <> 0 AND g.read_messages = 1)) AND g.is_confidential = 0", params: ["u-sep"],
  });
  const none = makeCtx(admin(), { ownDirectThreadsOnly: true, ownDirectUid: null });
  assert.match(threadVisibilitySql(none, "g").sql, /^\(1 = 0 OR \(g\.thread_type <> 0 AND g\.read_messages = 1\)\)/);
  // Mặc định (MCP hiện tại, giữ luật web) KHÔNG đổi
  assert.equal(threadVisibilitySql(everyone, "g").sql, "(g.thread_type = 0 OR g.read_messages = 1) AND g.is_confidential = 0");
  // Cuộc riêng trong danh sách conversations cũng theo cờ
  const list = compile("conversations", {}, own);
  assert.match(list.sql, /g\.zalo_group_id = \?/);
  assert.ok(list.params.includes("u-sep"));
});

test("H2 / L7: search_messages truyền ownDirectThreads cho truy vấn tìm", async () => {
  const { db, queries } = fakeDb(() => []);
  await runTool(tool("search_messages"), makeCtx(admin(), { ownDirectThreadsOnly: true, ownDirectUid: "u-sep" }, db), { query: "giá" });
  const select = queries.find((query) => query.sql.includes("FROM message_search"));
  assert.ok(select);
  assert.match(select.sql, /\(g\.thread_type = \? AND g\.zalo_group_id = \?\) OR \(g\.thread_type <> \? AND g\.read_messages = 1\)/);
  assert.ok(select.params.includes("u-sep"));
});
