import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanPersonName, pickContactMatch, type ContactMatch } from "./contact-search.js";

const match = (name: string, extra: Partial<ContactMatch> = {}): ContactMatch => ({ id: 1, uid: name, name, kind: 2, exact: false, inGroup: false, ...extra });

test("cleanPersonName: bỏ @ và xưng hô đứng đầu, giữ tên một chữ", () => {
  assert.equal(cleanPersonName("@Minh"), "Minh");
  assert.equal(cleanPersonName("anh Minh"), "Minh");
  assert.equal(cleanPersonName("chị Lan Anh"), "Lan Anh");
  assert.equal(cleanPersonName("@em Tú"), "Tú");
  assert.equal(cleanPersonName("Anh"), "Anh", "chỉ một chữ thì là tên, không bỏ");
});

test("pickContactMatch: một người / một người khớp đúng / một người ở nhóm thì chọn; còn lại để người dùng chọn", () => {
  assert.equal(pickContactMatch([match("Minh")])?.name, "Minh");
  assert.equal(pickContactMatch([match("Minh Anh"), match("Minh", { exact: true })])?.name, "Minh");
  assert.equal(pickContactMatch([match("Minh A"), match("Minh B")]), null);
  // Ở nhóm đang giao việc được ưu tiên trước người ngoài nhóm
  assert.equal(pickContactMatch([match("Minh A", { inGroup: true }), match("Minh", { exact: true })])?.name, "Minh A");
  assert.equal(pickContactMatch([match("Minh A", { inGroup: true }), match("Minh B", { inGroup: true })]), null);
  assert.equal(pickContactMatch([]), null);
});
