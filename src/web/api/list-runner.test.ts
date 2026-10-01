import assert from "node:assert/strict";
import { test } from "node:test";
import { diffFields } from "./audit-log.js";
import { combineWhere } from "./list-runner.js";

test("điều kiện cố định luôn AND với bộ lọc, kể cả khi bộ lọc nối bằng OR", () => {
  const combined = combineWhere({ sql: "g.thread_type = ?", params: [1] }, { sql: "WHERE (a = ?) OR (b = ?)", params: [2, 3] });
  // Thiếu ngoặc thì `thread_type = 1 AND a = 2 OR b = 3` lọt cả cuộc riêng khi b = 3
  assert.equal(combined.sql, "WHERE (g.thread_type = ?) AND ((a = ?) OR (b = ?))");
  assert.deepEqual(combined.params, [1, 2, 3]);
});

test("không có bộ lọc thì chỉ còn điều kiện cố định; không có điều kiện cố định thì giữ nguyên bộ lọc", () => {
  assert.equal(combineWhere({ sql: "x = 1", params: [] }, { sql: "", params: [] }).sql, "WHERE x = 1");
  assert.equal(combineWhere(undefined, { sql: "WHERE a = ?", params: [1] }).sql, "WHERE a = ?");
  assert.equal(combineWhere(undefined, { sql: "", params: [] }).sql, "");
});

test("diffFields: so bằng chuỗi nên 1 và '1' là một; mảng thẻ so theo nội dung; ô không gửi thì bỏ qua", () => {
  const labels = { role: "Vai trò", tags: "Thẻ", note: "Ghi chú", company_id: "Công ty" };
  // Dòng đã qua decorate() luôn có company_id = 0 khi chưa gán (không phải null)
  const before = { role: 1, tags: ["b", "a"], note: "x", company_id: 0 };
  assert.deepEqual(diffFields(before, { role: "1", tags: ["a", "b"], note: "x", company_id: "0" }, labels), []);
  assert.deepEqual(diffFields(before, { role: 2, tags: ["a"], company_id: 5 }, labels), ["Vai trò", "Thẻ", "Công ty"]);
});
