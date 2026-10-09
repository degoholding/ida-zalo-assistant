import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDueArgument, parseDueText } from "./task-due-parser.js";

// Thứ 6, 09/10/2026, 10:00 giờ VN
const NOW = new Date("2026-10-09T10:00:00+07:00");
const vn = (iso: string) => new Date(`${iso}+07:00`).toISOString();
const due = (text: string, now = NOW) => {
  const parsed = parseDueText(text, now);
  return parsed ? { at: parsed.at.toISOString(), hasTime: parsed.hasTime } : null;
};

test("ngày tương đối: hôm nay / mai / mốt, có hay không dấu", () => {
  assert.deepEqual(due("hôm nay"), { at: vn("2026-10-09T00:00:00"), hasTime: false });
  assert.deepEqual(due("mai"), { at: vn("2026-10-10T00:00:00"), hasTime: false });
  assert.deepEqual(due("ngay mai"), { at: vn("2026-10-10T00:00:00"), hasTime: false });
  assert.deepEqual(due("ngày mốt"), { at: vn("2026-10-11T00:00:00"), hasTime: false });
  assert.deepEqual(due("hạn mai"), { at: vn("2026-10-10T00:00:00"), hasTime: false });
});

test("thứ trong tuần: lần tới SAU hôm nay — «thứ 6» nói vào thứ 6 là thứ 6 tuần sau", () => {
  assert.equal(due("thứ 6")?.at, vn("2026-10-16T00:00:00"));
  assert.equal(due("t2")?.at, vn("2026-10-12T00:00:00"));
  assert.equal(due("thứ bảy")?.at, vn("2026-10-10T00:00:00"));
  assert.equal(due("chủ nhật")?.at, vn("2026-10-11T00:00:00"));
  assert.equal(due("thứ 2 tuần sau")?.at, vn("2026-10-12T00:00:00"));
  assert.equal(due("tuần sau thứ 6")?.at, vn("2026-10-16T00:00:00"));
  // Thứ 2 nói «thứ 4 tuần sau» = thứ 4 của tuần lịch kế tiếp, không phải 2 ngày nữa
  assert.equal(due("thứ 4 tuần sau", new Date("2026-10-12T09:00:00+07:00"))?.at, vn("2026-10-21T00:00:00"));
});

test("ngày tháng: dd/mm, dd/mm/yyyy, dd-mm-yy; ngày không tồn tại thì null", () => {
  assert.deepEqual(due("20/10"), { at: vn("2026-10-20T00:00:00"), hasTime: false });
  assert.equal(due("5/1/2027")?.at, vn("2027-01-05T00:00:00"));
  assert.equal(due("05-01-27")?.at, vn("2027-01-05T00:00:00"));
  assert.equal(due("31/2"), null);
  assert.equal(due("32/10"), null);
});

test("giờ: trước hoặc sau ngày, «chiều / tối» cộng 12, phút", () => {
  assert.deepEqual(due("17h thứ 6"), { at: vn("2026-10-16T17:00:00"), hasTime: true });
  assert.deepEqual(due("thứ 6 17h30"), { at: vn("2026-10-16T17:30:00"), hasTime: true });
  assert.deepEqual(due("mai 3h chiều"), { at: vn("2026-10-10T15:00:00"), hasTime: true });
  assert.deepEqual(due("20/10 9:05"), { at: vn("2026-10-20T09:05:00"), hasTime: true });
  assert.deepEqual(due("mai 9 giờ sáng"), { at: vn("2026-10-10T09:00:00"), hasTime: true });
});

test("chỉ có giờ: hôm nay lúc đó, đã qua thì ngày mai", () => {
  assert.deepEqual(due("17h"), { at: vn("2026-10-09T17:00:00"), hasTime: true });
  assert.deepEqual(due("8h"), { at: vn("2026-10-10T08:00:00"), hasTime: true });
});

test("cuối tuần = thứ 7 tuần này; cuối tháng = ngày cuối tháng (kể cả tháng 12, năm nhuận)", () => {
  assert.equal(due("cuối tuần")?.at, vn("2026-10-10T00:00:00"));
  assert.equal(due("cuối tháng")?.at, vn("2026-10-31T00:00:00"));
  assert.equal(due("cuối tháng", new Date("2026-12-05T10:00:00+07:00"))?.at, vn("2026-12-31T00:00:00"));
  assert.equal(due("cuối tháng", new Date("2028-02-10T10:00:00+07:00"))?.at, vn("2028-02-29T00:00:00"));
});

// Review 09/10/2026: «5/1» gõ ngày 28/12 từng thành 05/01 năm NAY (gần một năm trước) → quá hạn ngay, bắn tin cho cả 3 bên
test("dd/mm không ghi năm: đã lùi quá 7 ngày thì là năm sau; vài ngày trước thì vẫn năm nay", () => {
  assert.equal(due("5/1", new Date("2026-12-28T10:00:00+07:00"))?.at, vn("2027-01-05T00:00:00"));
  assert.equal(due("5/10")?.at, vn("2026-10-05T00:00:00"));
  assert.equal(due("20/9")?.at, vn("2027-09-20T00:00:00"));
});

test("đọc được đúng dạng hạn bot in ra: «T6 16/10», «thứ 6 16/10 17h»", () => {
  assert.deepEqual(due("T6 16/10"), { at: vn("2026-10-16T00:00:00"), hasTime: false });
  assert.deepEqual(due("17:00 T6 16/10"), { at: vn("2026-10-16T17:00:00"), hasTime: true });
  assert.deepEqual(due("thứ 6 16/10 17h"), { at: vn("2026-10-16T17:00:00"), hasTime: true });
});

test("không hiểu thì null — không đoán bừa", () => {
  for (const text of ["", "sớm nhất có thể", "tuần này", "25h", "17h99", "thứ 8", "mai mốt gì đó"]) assert.equal(due(text), null, text);
});

test("parseDueArgument (mô hình truyền): ISO ngày / ngày giờ, không múi giờ thì hiểu là giờ VN, chữ thường thì như lệnh gõ", () => {
  assert.deepEqual(parseDueArgument("2026-10-16", NOW), { at: new Date(vn("2026-10-16T00:00:00")), hasTime: false });
  assert.deepEqual(parseDueArgument("2026-10-16T17:00:00+07:00", NOW), { at: new Date(vn("2026-10-16T17:00:00")), hasTime: true });
  assert.deepEqual(parseDueArgument("2026-10-16T17:00:00", NOW), { at: new Date(vn("2026-10-16T17:00:00")), hasTime: true });
  assert.deepEqual(parseDueArgument("thứ 6", NOW), { at: new Date(vn("2026-10-16T00:00:00")), hasTime: false });
  assert.equal(parseDueArgument("2026-02-30", NOW), null);
  assert.equal(parseDueArgument(undefined, NOW), null);
  assert.equal(parseDueArgument(42, NOW), null);
  // Hạn vô lý (gõ nhầm / mô hình bịa): trước hôm qua hoặc quá 2 năm
  assert.equal(parseDueArgument("1999-01-01", NOW), null);
  assert.equal(parseDueArgument("2026-10-05", NOW), null);
  assert.equal(parseDueArgument("2030-01-01", NOW), null);
  assert.deepEqual(parseDueArgument("2026-10-08", NOW), { at: new Date(vn("2026-10-08T00:00:00")), hasTime: false }, "hôm qua vẫn nhận");
});
