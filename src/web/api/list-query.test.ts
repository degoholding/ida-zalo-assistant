import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCondition, buildConditionFromValues, escapeLikeText, MAX_IN_VALUES, OPERATORS, parseListRequest, type FieldSpec, type ListSpec } from "./list-query.js";

const spec: ListSpec = {
  fields: {
    kind: { sql: "c.kind", type: "number" },
    note: { sql: "c.note", type: "text" },
    last_dm_at: { sql: "c.last_dm_at", type: "date" },
    tag: { type: "text", build: (_operator, values) => ({ sql: "EXISTS (SELECT 1 FROM t WHERE t.tag IN (?))", params: [values] }) },
  },
  sorts: { name: "c.display_name", last_dm: "c.last_dm_at" },
  defaultSort: { by: "last_dm", dir: "desc" },
  tieBreaker: "c.id",
  search: { param: "name", columns: ["c.display_name", "c.zalo_uid"] },
};

const parse = (query: string) => parseListRequest(new URLSearchParams(query), spec);

test("không tham số: mặc định trang 1, 20 dòng, sắp xếp mặc định, không WHERE", () => {
  const request = parse("");
  assert.deepEqual([request.page, request.pageSize, request.offset, request.where.sql], [1, 20, 0, ""]);
  assert.equal(request.orderSql, "ORDER BY c.last_dm_at DESC, c.id");
});

test("lọc nhanh trần: số → bằng, chữ → chứa; ô tìm dò nhiều cột", () => {
  const request = parse("kind=1&note=vip&name=b%E1%BA%A3o");
  assert.equal(request.where.sql, "WHERE (c.kind = ?) AND (c.note LIKE ?) AND ((c.display_name LIKE ? OR c.zalo_uid LIKE ?))");
  assert.deepEqual(request.where.params, [1, "%vip%", "%bảo%", "%bảo%"]);
});

test("phép so có hậu tố + conjunction=or; in tách dấu phẩy; isnull", () => {
  const request = parse("kind__in=1,2&last_dm_at__isnull=true&conjunction=or");
  assert.equal(request.where.sql, "WHERE (c.kind IN (?)) OR (c.last_dm_at IS NULL)");
  assert.deepEqual(request.where.params, [[1, 2]]);
});

test("trường lạ, phép so lạ, giá trị sai kiểu → bỏ qua im lặng, KHÔNG nhét vào SQL", () => {
  const request = parse("drop_table=1&kind__lolz=1&kind=abc&last_dm_at__gte=khong-phai-ngay&kind__between=1");
  assert.equal(request.where.sql, "");
});

test("cố nhét SQL qua tên trường / sort_by → không lọt (chỉ nhận khóa đã khai)", () => {
  const request = parse("sort_by=c.id;DROP TABLE contact&sort_dir=sideways&kind) OR 1=1 --=1");
  assert.equal(request.orderSql, "ORDER BY c.last_dm_at DESC, c.id");
  assert.equal(request.where.sql, "");
});

test("sort_dir chỉ áp khi sort_by hợp lệ; trang & cỡ trang bị kẹp trong biên", () => {
  assert.equal(parse("sort_by=name&sort_dir=asc").orderSql, "ORDER BY c.display_name ASC, c.id");
  const request = parse("page=-5&page_size=100000");
  assert.deepEqual([request.page, request.pageSize], [1, 200]);
  assert.equal(parse("page=3&page_size=50").offset, 100);
});

test("điều kiện tự viết (EXISTS) nhận đủ danh sách giá trị", () => {
  const request = parse("tag__in=vip,đại lý");
  assert.deepEqual(request.where.params, [["vip", "đại lý"]]);
});

test("sort_by trùng thuộc tính của Object (constructor, __proto__, toString) → sắp xếp mặc định, không 500", () => {
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    const request = parse(`sort_by=${name}&sort_dir=asc`);
    assert.equal(request.orderSql, "ORDER BY c.last_dm_at DESC, c.id", name);
  }
});

test("buildConditionFromValues: nhận giá trị đã tách (không tách dấu phẩy), cùng kết quả với buildCondition", () => {
  const kind = spec.fields.kind;
  assert.deepEqual(buildConditionFromValues(kind, "in", ["1", "2"]), { sql: "c.kind IN (?)", params: [[1, 2]] });
  assert.deepEqual(buildCondition(kind, "in", "1,2"), buildConditionFromValues(kind, "in", ["1", "2"]));
  // chuỗi chứa dấu phẩy là MỘT giá trị khi đi đường JSON
  const note = spec.fields.note;
  assert.deepEqual(buildConditionFromValues(note, "eq", ["a,b"]), { sql: "c.note = ?", params: ["a,b"] });
  assert.deepEqual(buildConditionFromValues(note, "contains", ["a,b"]), { sql: "c.note LIKE ?", params: ["%a,b%"] });
  assert.deepEqual(buildConditionFromValues(kind, "between", ["1", "5"]), { sql: "c.kind BETWEEN ? AND ?", params: [1, 5] });
});

test("buildConditionFromValues: giá trị sai kiểu / thiếu → null; isnull; build tự viết nhận nguyên danh sách", () => {
  const kind = spec.fields.kind;
  assert.equal(buildConditionFromValues(kind, "eq", ["abc"]), null);
  assert.equal(buildConditionFromValues(kind, "in", []), null);
  assert.equal(buildConditionFromValues(kind, "between", ["1"]), null);
  assert.deepEqual(buildConditionFromValues(kind, "isnull", ["true"]), { sql: "c.kind IS NULL", params: [] });
  assert.deepEqual(buildConditionFromValues(kind, "isnull", ["false"]), { sql: "c.kind IS NOT NULL", params: [] });
  const noSql: FieldSpec = { type: "text" };
  assert.equal(buildConditionFromValues(noSql, "eq", ["x"]), null);
  assert.deepEqual(buildConditionFromValues(spec.fields.tag, "in", ["a", "b"]).params, [["a", "b"]]);
});

test("OPERATORS + MAX_IN_VALUES được xuất cho lõi truy cập dữ liệu", () => {
  assert.equal(OPERATORS.size, 12);
  assert.ok(OPERATORS.has("between") && !OPERATORS.has("like" as never));
  assert.equal(MAX_IN_VALUES, 200);
  const many = Array.from({ length: 300 }, (_, index) => index).join(",");
  assert.equal((buildCondition(spec.fields.kind, "in", many)?.params[0] as number[]).length, MAX_IN_VALUES);
});

test("contains / not_contains / ô tìm: thoát % _ \\ (không thành ký tự đại diện)", () => {
  const note = spec.fields.note;
  assert.deepEqual(buildConditionFromValues(note, "contains", ["50%_a\\b"]), { sql: "c.note LIKE ?", params: ["%50\\%\\_a\\\\b%"] });
  assert.deepEqual(buildConditionFromValues(note, "not_contains", ["%"]), { sql: "c.note NOT LIKE ?", params: ["%\\%%"] });
  assert.equal(escapeLikeText("a%b_c\\d"), "a\\%b\\_c\\\\d");
  const request = parse("name=%25_");
  assert.deepEqual(request.where.params, ["%\\%\\_%", "%\\%\\_%"]);
});
