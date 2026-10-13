import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogKind, CatalogMatchStatus, ContactKind } from "../constants.js";
import { matchCatalogEntry } from "./catalog-matcher.js";
import { matchName, toLocalPhone } from "./catalog-text.js";
import type { MatchContact } from "./catalog-types.js";

const contact = (id: number, name: string, kind: number = ContactKind.Staff, phone = ""): MatchContact => ({ id, name, kind, phone });
const none: ReadonlySet<number> = new Set();
const staff = (name: string, phone = "") => ({ kind: CatalogKind.Staff, name, phone });
const dealer = (name: string, phone = "") => ({ kind: CatalogKind.Dealer, name, phone });

test("toLocalPhone: các dạng số VN → 0xxxxxxxxx; trống → ''; sai → null", () => {
  assert.equal(toLocalPhone("0912 345 678"), "0912345678");
  assert.equal(toLocalPhone("+84912345678"), "0912345678");
  assert.equal(toLocalPhone(912345678), "0912345678");
  assert.equal(toLocalPhone(""), "");
  assert.equal(toLocalPhone("12345"), null);
  assert.equal(toLocalPhone("0212345678"), null);
});

test("matchName: gấp dấu, bỏ xưng hô / ĐL / đại lý đứng đầu", () => {
  assert.equal(matchName("Anh Nguyễn Văn Huy"), "nguyen van huy");
  assert.equal(matchName("ĐL Thành Công"), "thanh cong");
  assert.equal(matchName("Đại lý Hòa Bình"), "hoa binh");
  assert.equal(matchName("a. Tâm"), "tam");
});

test("SĐT trùng đúng 1 liên hệ → Matched, thắng cả khi tên khác", () => {
  const result = matchCatalogEntry(staff("Huy", "0912345678"), [contact(1, "Người khác", ContactKind.Staff, "0912345678"), contact(2, "Huy")], none);
  assert.deepEqual(result, { status: CatalogMatchStatus.Matched, contactId: 1, candidates: [] });
});

test("tên gấp dấu trùng đúng 1 liên hệ đúng loại → Matched", () => {
  const result = matchCatalogEntry(staff("Nguyễn Văn Huy"), [contact(1, "anh nguyen van huy"), contact(2, "Trần Tâm")], none);
  assert.equal(result.status, CatalogMatchStatus.Matched);
  assert.equal(result.contactId, 1);
});

test("đại lý: khớp Khách hàng / Chưa phân loại, bỏ tiền tố ĐL", () => {
  const result = matchCatalogEntry(dealer("ĐL Thành Công"), [contact(7, "Thành Công", ContactKind.Customer)], none);
  assert.equal(result.status, CatalogMatchStatus.Matched);
  const unclassified = matchCatalogEntry(dealer("ĐL Thành Công"), [contact(7, "Thành Công", ContactKind.Unclassified)], none);
  assert.equal(unclassified.status, CatalogMatchStatus.Matched);
});

test("tên trùng 2 người → Suggested, không tự gắn", () => {
  const result = matchCatalogEntry(staff("Huy"), [contact(1, "Huy"), contact(2, "Huy")], none);
  assert.equal(result.status, CatalogMatchStatus.Suggested);
  assert.deepEqual(result.candidates.map((c) => c.contactId), [1, 2]);
  assert.equal(result.contactId, undefined);
});

test("sai loại → Suggested", () => {
  const result = matchCatalogEntry(staff("Huy"), [contact(1, "Huy", ContactKind.Customer)], none);
  assert.equal(result.status, CatalogMatchStatus.Suggested);
  assert.equal(matchCatalogEntry(dealer("Thành Công"), [contact(1, "Thành Công", ContactKind.Staff)], none).status, CatalogMatchStatus.Suggested);
});

test("liên hệ đã gắn mục khác → Suggested (theo tên và theo SĐT)", () => {
  const linked = new Set([1]);
  assert.equal(matchCatalogEntry(staff("Huy"), [contact(1, "Huy")], linked).status, CatalogMatchStatus.Suggested);
  assert.equal(matchCatalogEntry(staff("Tên khác", "0912345678"), [contact(1, "Huy", ContactKind.Staff, "0912345678")], linked).status, CatalogMatchStatus.Suggested);
});

test("khớp một phần (họ + tên cuối) → Suggested; tên gọi đơn trùng từ cuối → điểm thấp hơn", () => {
  const partial = matchCatalogEntry(staff("Nguyễn Huy"), [contact(1, "Nguyễn Văn Huy")], none);
  assert.equal(partial.status, CatalogMatchStatus.Suggested);
  assert.equal(partial.candidates[0].score, 0.6);
  const single = matchCatalogEntry(staff("Huy"), [contact(1, "Nguyễn Văn Huy")], none);
  assert.equal(single.status, CatalogMatchStatus.Suggested);
  assert.equal(single.candidates[0].score, 0.5);
});

test("không liên quan → Unmatched; tối đa 5 ứng viên", () => {
  assert.equal(matchCatalogEntry(staff("Huy"), [contact(1, "Lan")], none).status, CatalogMatchStatus.Unmatched);
  const many = Array.from({ length: 8 }, (_, i) => contact(i + 1, "Huy"));
  assert.equal(matchCatalogEntry(staff("Huy"), many, none).candidates.length, 5);
});

test("SĐT trùng 2 liên hệ → Suggested, không tự gắn dù tên khớp 1 người", () => {
  const contacts = [contact(1, "Huy", ContactKind.Staff, "0912345678"), contact(2, "Khác", ContactKind.Staff, "0912345678")];
  assert.equal(matchCatalogEntry(staff("Huy", "0912345678"), contacts, none).status, CatalogMatchStatus.Suggested);
});
