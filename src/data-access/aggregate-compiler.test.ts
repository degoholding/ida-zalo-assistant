import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_GROUPS, type CompiledAggregate } from "./aggregate-compiler.js";
import { DataAccessError, type DataAccessErrorCode } from "./data-access-errors.js";
import { admin, makeCtx, manager, staff } from "./data-access-test-support.js";
import { findEntity } from "./entity-registry.js";
import { compileQuery } from "./query-compiler.js";
import type { QueryRequest } from "./query-dsl-schema.js";

const adminCtx = makeCtx(admin());

function aggregate(entity: string, request: Partial<QueryRequest>, ctx = adminCtx): CompiledAggregate {
  const compiled = compileQuery(findEntity(entity)!, ctx, { entity, ...request });
  assert.equal(compiled.kind, "aggregate");
  return compiled as CompiledAggregate;
}

function rejects(run: () => unknown, code: DataAccessErrorCode): DataAccessError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof DataAccessError, String(error));
    assert.equal(error.code, code, error.message);
    return error;
  }
  assert.fail(`cần lỗi ${code}`);
}

test("đếm theo cuộc + ngày VN: CONVERT_TZ không cần bảng múi giờ, LIMIT 501 để biết bị cắt", () => {
  const out = aggregate("messages", {
    filters: [{ field: "sent_at", op: "gte", value: "2026-10-01" }],
    aggregate: { fn: "count", group_by: [{ field: "thread_id" }, { field: "sent_at", bucket: "day" }] },
  });
  assert.match(out.sql, /SELECT \/\*\+ MAX_EXECUTION_TIME\(5000\) \*\/ m\.group_id AS `thread_id`, DATE_FORMAT\(CONVERT_TZ\(m\.sent_at, '\+00:00', '\+07:00'\), '%Y-%m-%d'\) AS `sent_at`, COUNT\(\*\) AS `count` FROM message m/);
  assert.match(out.sql, /GROUP BY m\.group_id, DATE_FORMAT\(CONVERT_TZ\(m\.sent_at, '\+00:00', '\+07:00'\), '%Y-%m-%d'\) ORDER BY `count` DESC, m\.group_id, DATE_FORMAT/);
  assert.match(out.sql, /LIMIT 501$/);
  assert.equal(MAX_GROUPS, 500);
  assert.deepEqual(out.groupBy.map((by) => [by.key, by.type]), [["thread_id", "number"], ["sent_at", "text"]]);
  // Điều kiện cố định (tin thu hồi, Mật) vẫn áp cho gộp nhóm
  assert.match(out.sql, /m\.recalled_at IS NULL/);
  assert.match(out.sql, /g\.is_confidential = 0/);
});

test("bucket tháng; cột DATE đã định dạng (metrics) gộp tháng bằng LEFT(…, 7)", () => {
  const month = aggregate("messages", { filters: [{ field: "thread_id", op: "eq", value: 3 }], aggregate: { fn: "count", group_by: [{ field: "sent_at", bucket: "month" }] } });
  assert.match(month.sql, /DATE_FORMAT\(CONVERT_TZ\(m\.sent_at, '\+00:00', '\+07:00'\), '%Y-%m'\)/);
  const metrics = aggregate("metrics", { aggregate: { fn: "sum", field: "value", group_by: [{ field: "metric_date", bucket: "month" }] } }, makeCtx(manager()));
  assert.match(metrics.sql, /LEFT\(DATE_FORMAT\(v\.metric_date, '%Y-%m-%d'\), 7\) AS `metric_date`, COUNT\(\*\) AS `count`, SUM\(v\.value\) AS `sum`/);
  assert.match(metrics.sql, /ORDER BY `sum` DESC/);
  assert.equal(metrics.sumKey, "value");
});

test("không group_by → một dòng tổng, không GROUP BY", () => {
  const out = aggregate("groups", { aggregate: { fn: "count" } });
  assert.doesNotMatch(out.sql, /GROUP BY/);
  assert.match(out.sql, /COUNT\(\*\) AS `count` FROM zalo_group g/);
});

test("cộng: cột cộng được lấy từ khai báo thực thể", () => {
  const out = aggregate("files", { aggregate: { fn: "sum", field: "size", group_by: [{ field: "file_ext" }] } });
  assert.match(out.sql, /SUM\(COALESCE\(a\.stored_bytes, a\.declared_size, 0\)\) AS `sum`/);
});

test("lỗi: cột nhóm / cột cộng ngoài danh sách → invalid_field kèm danh sách hợp lệ", () => {
  const group = rejects(() => aggregate("messages", { aggregate: { fn: "count", group_by: [{ field: "text" }] }, filters: [{ field: "thread_id", op: "eq", value: 1 }] }), "invalid_field");
  assert.ok(group.allowed?.includes("thread_id") && !group.allowed.includes("text"));
  rejects(() => aggregate("messages", { aggregate: { fn: "count", group_by: [{ field: "id; DROP TABLE x" }] } }), "invalid_field");
  rejects(() => aggregate("messages", { aggregate: { fn: "count", group_by: [{ field: "__proto__" }] } }), "invalid_field");
  const sum = rejects(() => aggregate("files", { aggregate: { fn: "sum", field: "file_name" } }), "invalid_field");
  assert.deepEqual(sum.allowed, ["size"]);
  rejects(() => aggregate("files", { aggregate: { fn: "sum" } }), "invalid_field");
  rejects(() => aggregate("messages", { aggregate: { fn: "sum", field: "id" }, filters: [{ field: "thread_id", op: "eq", value: 1 }] }), "invalid_field");
});

test("lỗi: phép / hình dạng sai → invalid_value", () => {
  rejects(() => aggregate("groups", { aggregate: { fn: "avg" as never } }), "invalid_value");
  rejects(() => aggregate("groups", { aggregate: { fn: "count", field: "member_count" } }), "invalid_value");
  rejects(() => aggregate("groups", { aggregate: { fn: "count", group_by: [{ field: "group_kind" }, { field: "company_id" }, { field: "read_messages" }] } }), "invalid_value");
  rejects(() => aggregate("groups", { aggregate: { fn: "count", group_by: [{ field: "group_kind" }, { field: "group_kind" }] } }), "invalid_value");
  rejects(() => aggregate("groups", { aggregate: { fn: "count", group_by: [{ field: "group_kind", bucket: "day" }] } }), "invalid_value");
  rejects(() => aggregate("messages", { aggregate: { fn: "count", group_by: [{ field: "sent_at", bucket: "year" as never }] }, filters: [{ field: "thread_id", op: "eq", value: 1 }] }), "invalid_value");
  rejects(() => aggregate("groups", { aggregate: { fn: "count" }, fields: ["id"] }), "invalid_value");
  rejects(() => aggregate("groups", { aggregate: { fn: "count" }, sort: { field: "name" } }), "invalid_value");
});

test("gộp nhóm vẫn kiểm bộ lọc bắt buộc và lỗi lọc như liệt kê dòng", () => {
  rejects(() => aggregate("messages", { aggregate: { fn: "count" } }), "missing_required_filter");
  rejects(() => aggregate("groups", { aggregate: { fn: "count" }, filters: [{ field: "nope", op: "eq", value: 1 }] }), "invalid_field");
});

test("cột cần quyền riêng không gộp nhóm được: SĐT không bao giờ là cột nhóm", () => {
  rejects(() => aggregate("contacts", { aggregate: { fn: "count", group_by: [{ field: "phone" }] } }, makeCtx(manager())), "invalid_field");
  rejects(() => aggregate("contacts", { aggregate: { fn: "count", group_by: [{ field: "phone" }] } }, makeCtx(staff())), "invalid_field");
});

test("cột nhóm chứa nội dung người ngoài được đánh dấu untrusted", () => {
  const out = aggregate("audit_log", { aggregate: { fn: "count", group_by: [{ field: "actor" }] } });
  assert.deepEqual(out.groupBy.map((by) => by.untrusted), [false]);
});
