import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeLikeText } from "../web/api/list-query.js";
import { admin, compileRows as compile, makeCtx, manager, rejects, staff } from "./data-access-test-support.js";

const adminCtx = makeCtx(admin());
const adminMatCtx = makeCtx(admin({ canViewConfidential: true }));
const staffCtx = makeCtx(staff());
const managerCtx = makeCtx(manager());

test("mặc định: cột mặc định, phạm vi + Mật (admin không cờ Mật bị ẩn nhóm Mật), LIMIT size+1", () => {
  const out = compile("groups");
  assert.match(out.sql, /^SELECT \/\*\+ MAX_EXECUTION_TIME\(5000\) \*\/ g\.id AS `id`, g\.name AS `name`/);
  assert.match(out.sql, /FROM zalo_group g LEFT JOIN company co ON co\.id = g\.company_id WHERE \(g\.thread_type = \?\) AND \(g\.is_confidential = 0\) ORDER BY g\.last_message_at IS NULL, g\.last_message_at DESC, g\.id LIMIT \? OFFSET \?$/);
  assert.deepEqual(out.params, [1, 51, 0]);
  assert.deepEqual(out.fields, ["id", "name", "label", "group_kind", "company_name", "member_count", "last_message_at"]);
  assert.equal(out.includeTotal, false);
});

test("ctx có Mật → không còn điều kiện is_confidential; người bị khoanh → IN danh sách nhóm", () => {
  assert.doesNotMatch(compile("groups", {}, adminMatCtx).sql, /is_confidential = 0/);
  const scoped = compile("groups", {}, staffCtx);
  assert.match(scoped.sql, /\(g\.id IN \(\?\) AND g\.is_confidential = 0\)|g\.id IN \(\?\) AND g\.is_confidential = 0/);
  assert.deepEqual(scoped.params, [1, [11, 12], 51, 0]);
  const empty = compile("groups", {}, makeCtx(staff({ groupIds: [] })));
  assert.match(empty.sql, /1 = 0/);
});

test("lọc: text / number / boolean / isnull / in sinh SQL tham số hóa, giá trị ép kiểu", () => {
  const out = compile("groups", { filters: [
    { field: "name", op: "contains", value: "Huy" },
    { field: "group_kind", op: "in", value: [1, "2"] },
    { field: "read_messages", op: "eq", value: true },
    { field: "member_count", op: "gte", value: "10" },
    { field: "last_message_at", op: "isnull", value: false },
    { field: "label", op: "ne", value: 5 },
  ] });
  assert.match(out.sql, /WHERE \(\(g\.thread_type = \?\) AND \(g\.is_confidential = 0\)\) AND \(\(g\.name LIKE \?\) AND \(g\.group_kind IN \(\?\)\) AND \(g\.read_messages = \?\) AND \(g\.member_count >= \?\) AND \(g\.last_message_at IS NOT NULL\) AND \(g\.label <> \?\)\)/);
  assert.deepEqual(out.params, [1, "%Huy%", [1, 2], 1, 10, "5", 51, 0]);
});

test("isnull không kèm value hiểu là true", () => {
  assert.match(compile("groups", { filters: [{ field: "last_message_at", op: "isnull" }] }).sql, /g\.last_message_at IS NULL/);
});

test("ngày: chỉ ngày = cả ngày VN; có giờ = thời điểm; không múi → giờ VN", () => {
  const eqDay = compile("groups", { filters: [{ field: "last_message_at", op: "eq", value: "2026-10-05" }] });
  assert.match(eqDay.sql, /\(g\.last_message_at >= \? AND g\.last_message_at < \?\)/);
  assert.deepEqual(eqDay.params.slice(1, 3), [new Date("2026-10-04T17:00:00Z"), new Date("2026-10-05T17:00:00Z")]);
  const gtDay = compile("groups", { filters: [{ field: "last_message_at", op: "gt", value: "2026-10-05" }] });
  assert.match(gtDay.sql, /g\.last_message_at >= \?/);
  assert.deepEqual(gtDay.params[1], new Date("2026-10-05T17:00:00Z"));
  const lteDay = compile("groups", { filters: [{ field: "last_message_at", op: "lte", value: "2026-10-05" }] });
  assert.match(lteDay.sql, /g\.last_message_at < \?/);
  assert.deepEqual(lteDay.params[1], new Date("2026-10-05T17:00:00Z"));
  const eqTime = compile("groups", { filters: [{ field: "last_message_at", op: "eq", value: "2026-10-05T09:30:00" }] });
  assert.match(eqTime.sql, /g\.last_message_at = \?/);
  assert.deepEqual(eqTime.params[1], new Date("2026-10-05T02:30:00Z"));
  const gtTime = compile("groups", { filters: [{ field: "last_message_at", op: "gt", value: "2026-10-05T09:30:00+07:00" }] });
  assert.match(gtTime.sql, /g\.last_message_at > \?/);
  const between = compile("groups", { filters: [{ field: "last_message_at", op: "between", value: ["2026-10-01", "2026-10-05"] }] });
  assert.match(between.sql, /\(g\.last_message_at >= \? AND g\.last_message_at < \?\)/);
  assert.deepEqual(between.params.slice(1, 3), [new Date("2026-09-30T17:00:00Z"), new Date("2026-10-05T17:00:00Z")]);
  const betweenTime = compile("groups", { filters: [{ field: "last_message_at", op: "between", value: ["2026-10-01T08:00", "2026-10-01T12:00"] }] });
  assert.match(betweenTime.sql, /\(g\.last_message_at >= \? AND g\.last_message_at <= \?\)/);
});

test("trường ngày dùng hàm build của web (hạn việc / ngày số liệu) chỉ nhận NGÀY", () => {
  const due = compile("tasks", { filters: [{ field: "due_at", op: "between", value: ["2026-10-01", "2026-10-05"] }] });
  assert.match(due.sql, /\(t\.due_at >= \? AND t\.due_at < \?\)/);
  assert.deepEqual(due.params.slice(1, 3), [new Date("2026-09-30T17:00:00Z"), new Date("2026-10-05T17:00:00Z")]);
  rejects(() => compile("tasks", { filters: [{ field: "due_at", op: "eq", value: "2026-10-05T10:00" }] }), "invalid_value", /chỉ lọc theo ngày/);
  const metric = compile("metrics", { filters: [{ field: "metric_date", op: "eq", value: "2026-10-05" }] }, managerCtx);
  assert.match(metric.sql, /v\.metric_date = \?/);
  assert.ok(metric.params.includes("2026-10-05"));
  // Phép isnull không dành cho trường build
  rejects(() => compile("tasks", { filters: [{ field: "due_at", op: "isnull", value: true }] }), "invalid_operator");
});

test("boolean ép về 1/0 trước khi vào hàm build của web (overdue / has_text / direct)", () => {
  assert.match(compile("tasks", { filters: [{ field: "overdue", op: "eq", value: true }] }).sql, /t\.status = \? AND t\.due_at IS NOT NULL/);
  assert.match(compile("tasks", { filters: [{ field: "overdue", op: "eq", value: "false" }] }).sql, /NOT \(t\.status = \?/);
  assert.match(compile("files", { filters: [{ field: "has_text", op: "eq", value: true }] }).sql, /t\.text IS NOT NULL/);
  assert.match(compile("files", { filters: [{ field: "has_text", op: "eq", value: false }] }).sql, /t\.text IS NULL/);
  rejects(() => compile("files", { filters: [{ field: "has_text", op: "ne", value: true }] }), "invalid_operator");
});

test("trường lạ → invalid_field kèm danh sách hợp lệ; nguyên mẫu object không lọt", () => {
  const error = rejects(() => compile("groups", { filters: [{ field: "phone", op: "eq", value: "1" }] }), "invalid_field", /«phone»/);
  assert.ok(error.allowed?.includes("name") && !error.allowed.includes("phone"));
  for (const field of ["__proto__", "constructor", "toString", "hasOwnProperty", "name; DROP TABLE zalo_group", "name) OR 1=1 --", "g.name", "NAME"]) {
    rejects(() => compile("groups", { filters: [{ field, op: "eq", value: "x" }] }), "invalid_field");
  }
});

test("phép so sai kiểu → invalid_operator kèm phép hợp lệ", () => {
  const error = rejects(() => compile("groups", { filters: [{ field: "member_count", op: "contains", value: "1" }] }), "invalid_operator", /member_count/);
  assert.ok(error.allowed?.includes("between") && !error.allowed.includes("contains"));
  rejects(() => compile("groups", { filters: [{ field: "name", op: "gt", value: "a" }] }), "invalid_operator");
  rejects(() => compile("groups", { filters: [{ field: "read_messages", op: "contains", value: true }] }), "invalid_operator");
  rejects(() => compile("groups", { filters: [{ field: "last_message_at", op: "contains", value: "2026" }] }), "invalid_operator");
  rejects(() => compile("groups", { filters: [{ field: "name", op: "between", value: ["a", "b"] }] }), "invalid_operator");
  rejects(() => compile("groups", { filters: [{ field: "name", op: "DROP" as never, value: "a" }] }), "invalid_operator");
});

test("giá trị sai kiểu / sai hình dạng → invalid_value", () => {
  const bad: [string, string, unknown][] = [
    ["member_count", "eq", "abc"], ["member_count", "eq", "1; DROP TABLE x"], ["member_count", "eq", true], ["member_count", "eq", Number.NaN],
    ["member_count", "eq", [1]], ["member_count", "in", 5], ["member_count", "in", []], ["member_count", "between", [1]], ["member_count", "between", [1, 2, 3]],
    ["read_messages", "eq", "maybe"], ["read_messages", "eq", 2], ["name", "eq", true], ["name", "eq", ["a"]], ["name", "eq", "x".repeat(501)],
    ["last_message_at", "eq", "2026-02-30"], ["last_message_at", "eq", 20261005], ["last_message_at", "eq", "hôm qua"],
    ["last_message_at", "between", ["2026-10-01", "xx"]], ["last_message_at", "isnull", "yes"], ["name", "eq", undefined],
  ];
  for (const [field, op, value] of bad) {
    rejects(() => compile("groups", { filters: [{ field, op: op as never, value: value as never }] }), "invalid_value");
  }
  rejects(() => compile("groups", { filters: [{ field: "member_count", op: "in", value: Array.from({ length: 201 }, (_, i) => i) }] }), "invalid_value", /200/);
  // Đúng 200 giá trị thì được
  compile("groups", { filters: [{ field: "member_count", op: "in", value: Array.from({ length: 200 }, (_, i) => i) }] });
});

test("giá trị chứa SQL chỉ đi qua tham số, không vào câu lệnh", () => {
  const evil = "'; DROP TABLE zalo_group; --";
  const out = compile("groups", { filters: [{ field: "name", op: "contains", value: evil }, { field: "label", op: "in", value: [evil, "\\"] }] });
  assert.doesNotMatch(out.sql, /DROP|--/);
  assert.ok(out.params.includes(`%${escapeLikeText(evil)}%`));
  assert.ok(out.params.some((param) => Array.isArray(param) && param.includes(evil)));
});

test("chọn cột: cột lạ / cột chèn SQL → invalid_field; trùng khóa được gộp", () => {
  const error = rejects(() => compile("groups", { fields: ["id", "password_hash"] }), "invalid_field", /password_hash/);
  assert.ok(error.allowed?.includes("name"));
  rejects(() => compile("groups", { fields: ["id, (SELECT password_hash FROM app_user)"] }), "invalid_field");
  rejects(() => compile("groups", { fields: ["g.id"] }), "invalid_field");
  rejects(() => compile("groups", { fields: ["__proto__"] }), "invalid_field");
  rejects(() => compile("groups", { fields: Array.from({ length: 41 }, (_, i) => `f${i}`) }), "invalid_value");
  assert.deepEqual(compile("groups", { fields: ["id", "id", "name"] }).fields, ["id", "name"]);
  assert.match(compile("groups", { fields: ["name"] }).sql, /SELECT \/\*\+[^*]+\*\/ g\.name AS `name` FROM/);
});

test("sắp xếp: chỉ khóa trong spec, chiều asc/desc, luôn kèm tie-breaker", () => {
  assert.match(compile("groups", { sort: { field: "member_count" } }).sql, /ORDER BY g\.member_count ASC, g\.id/);
  assert.match(compile("groups", { sort: { field: "name", dir: "desc" } }).sql, /ORDER BY COALESCE\(NULLIF\(g\.label, ''\), g\.name\) DESC, g\.id/);
  const error = rejects(() => compile("groups", { sort: { field: "password; DROP" } }), "invalid_field");
  assert.ok(error.allowed?.includes("last_message_at"));
  for (const field of ["constructor", "__proto__", "toString", "g.name"]) rejects(() => compile("groups", { sort: { field } }), "invalid_field");
  rejects(() => compile("groups", { sort: { field: "name", dir: "sideways" as never } }), "invalid_value", undefined);
});

test("phân trang: mặc định 50, tối đa 100, OFFSET tối đa 10 000", () => {
  assert.deepEqual(compile("groups", { page: { size: 100, number: 3 } }).params.slice(-2), [101, 200]);
  assert.equal(compile("groups", { page: { size: 100, number: 101 } }).params.at(-1), 10_000);
  rejects(() => compile("groups", { page: { size: 100, number: 102 } }), "page_too_deep");
  rejects(() => compile("groups", { page: { size: 101 } }), "invalid_value");
  rejects(() => compile("groups", { page: { size: 0 } }), "invalid_value");
  rejects(() => compile("groups", { page: { number: 0 } }), "invalid_value");
  rejects(() => compile("groups", { page: { size: 1.5 } }), "invalid_value");
});

test("include_total: câu đếm có trần 10 001 và cùng điều kiện", () => {
  const out = compile("groups", { include_total: true, filters: [{ field: "name", op: "eq", value: "A" }] });
  assert.equal(out.includeTotal, true);
  assert.match(out.countSql, /COUNT\(\*\) AS n FROM \(SELECT 1 FROM zalo_group g .* LIMIT 10001\) counted$/);
  assert.deepEqual(out.countParams, [1, "A"]);
});

