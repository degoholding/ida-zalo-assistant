import assert from "node:assert/strict";
import { test } from "node:test";
import { SendTargetKind } from "../constants.js";
import { describeChoices, pickTarget, type TargetCandidate } from "./send-target-matcher.js";

const group = (id: number, name: string, extra: Partial<TargetCandidate> = {}): TargetCandidate => ({
  target: { kind: SendTargetKind.Group, key: `g:${id}`, threadId: id, zaloUid: null, displayName: name },
  names: [name], allowed: true, reason: "", secret: false, ...extra,
});
const person = (id: number, name: string, extra: Partial<TargetCandidate> = {}): TargetCandidate => ({
  target: { kind: SendTargetKind.Person, key: `u:${id}`, threadId: null, zaloUid: String(id), displayName: name },
  names: [name], allowed: true, reason: "", secret: false, ...extra,
});

test("một nhóm khớp duy nhất (không dấu, hoa thường)", () => {
  const result = pickTarget("nhom kho hn", [group(1, "Kho HN"), group(2, "Kế toán")]);
  assert.equal(result.kind, "ok");
  assert.equal(result.kind === "ok" && result.candidate.target.threadId, 1);
});

test("khớp đúng tên thắng khớp một phần", () => {
  const result = pickTarget("nhóm Kho", [group(1, "Kho"), group(2, "Kho HN")]);
  assert.equal(result.kind === "ok" && result.candidate.target.threadId, 1);
});

test("khớp một phần nhiều nơi → mơ hồ, liệt kê", () => {
  const result = pickTarget("nhóm Kho", [group(1, "Kho HN"), group(2, "Kho HCM")]);
  assert.equal(result.kind, "ambiguous");
  assert.equal(result.kind === "ambiguous" && result.choices.length, 2);
});

test("không tiền tố: nhóm và người cùng tên → mơ hồ; có «nhóm» / «anh» thì chọn được", () => {
  const all = [group(1, "Minh"), person(2, "Minh")];
  assert.equal(pickTarget("Minh", all).kind, "ambiguous");
  assert.equal(pickTarget("nhóm Minh", all).kind === "ok" && (pickTarget("nhóm Minh", all) as { candidate: TargetCandidate }).candidate.target.kind, SendTargetKind.Group);
  const byTitle = pickTarget("anh Minh", all);
  assert.equal(byTitle.kind === "ok" && byTitle.candidate.target.kind, SendTargetKind.Person);
});

test("xưng hô «anh» chỉ khớp người; tên nhóm bắt đầu bằng «Anh» vẫn khớp khi không dùng tiền tố nhóm", () => {
  assert.equal(pickTarget("anh Kho", [group(1, "Kho")]).kind, "notFound");
  assert.equal(pickTarget("Anh Thư", [person(1, "Anh Thư")]).kind, "ok");
});

test("không thấy → notFound", () => {
  assert.equal(pickTarget("nhóm Zzz", [group(1, "Kho HN")]).kind, "notFound");
  assert.equal(pickTarget("   ", [group(1, "Kho HN")]).kind, "notFound");
});

test("nơi bị cấm → notAllowed kèm lý do; nơi hợp lệ khác cùng khớp thì chọn nơi hợp lệ", () => {
  const blocked = group(1, "Khách ABC", { allowed: false, reason: "nhóm khách" });
  const denied = pickTarget("nhóm Khách ABC", [blocked]);
  assert.deepEqual(denied, { kind: "notAllowed", reason: "nhóm khách", name: "nhóm Khách ABC" });
  const mixed = pickTarget("Kho", [group(1, "Kho HN"), group(2, "Kho Khách", { allowed: false, reason: "nhóm khách" })]);
  assert.equal(mixed.kind, "ok");
});

test("khớp đúng tên nhưng bị cấm thì không âm thầm đổi sang khớp một phần", () => {
  const result = pickTarget("nhóm Kho", [group(1, "Kho", { allowed: false, reason: "nhóm khách" }), group(2, "Kho HN")]);
  assert.equal(result.kind, "notAllowed");
});

test("khớp qua nhãn (names có nhiều tên)", () => {
  const result = pickTarget("nhóm kho", [group(1, "Nhóm công việc số 7", { names: ["Nhóm công việc số 7", "Kho"] })]);
  assert.equal(result.kind, "ok");
});

test("câu hỏi lại nêu tên thật các lựa chọn", () => {
  const text = describeChoices("Minh", [group(1, "Minh"), person(2, "Minh")]);
  assert.match(text, /nhóm «Minh»/);
  assert.match(text, /anh\/chị Minh/);
  assert.match(text, /ghi rõ «nhóm …» hoặc «anh …»/);
});
