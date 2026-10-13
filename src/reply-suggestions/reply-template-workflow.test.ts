import assert from "node:assert/strict";
import { test } from "node:test";
import { ReplyTemplateStatus as S } from "../constants.js";
import { decideTemplateTransition, ReplyTemplateError, validateTemplateInput, type TransitionRequest } from "./reply-template-workflow.js";

const base = { status: S.Draft, isAuthor: false, canApprove: false } as const;
const decide = (request: Partial<TransitionRequest> & { action: TransitionRequest["action"] }) => decideTemplateTransition({ ...base, ...request });

test("sửa: người soạn sửa được, về Chờ duyệt", () => {
  assert.deepEqual(decide({ action: "edit", isAuthor: true, status: S.Returned }), { ok: true, next: S.PendingReview });
});

test("sửa: nhân viên không phải người soạn bị chặn", () => {
  const result = decide({ action: "edit", status: S.Draft });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "forbidden");
});

test("sửa mẫu Đã duyệt: người duyệt giữ Đã duyệt, người soạn thường → về Chờ duyệt (bot ngừng dùng)", () => {
  assert.deepEqual(decide({ action: "edit", canApprove: true, status: S.Approved }), { ok: true, next: S.Approved });
  assert.deepEqual(decide({ action: "edit", isAuthor: true, status: S.Approved }), { ok: true, next: S.PendingReview });
});

test("sửa mẫu Ngừng dùng → vào lại Chờ duyệt", () => {
  assert.deepEqual(decide({ action: "edit", isAuthor: true, status: S.Archived }), { ok: true, next: S.PendingReview });
});

test("gửi duyệt: chỉ từ Nháp", () => {
  assert.deepEqual(decide({ action: "submit", isAuthor: true, status: S.Draft }), { ok: true, next: S.PendingReview });
  const result = decide({ action: "submit", isAuthor: true, status: S.Approved });
  assert.equal(!result.ok && result.code, "conflict");
});

test("duyệt: nhân viên bị chặn", () => {
  const result = decide({ action: "approve", isAuthor: true, status: S.PendingReview });
  assert.equal(!result.ok && result.code, "forbidden");
});

test("duyệt: người có quyền duyệt (kể cả người soạn) duyệt được mẫu Chờ duyệt", () => {
  assert.deepEqual(decide({ action: "approve", canApprove: true, isAuthor: true, status: S.PendingReview }), { ok: true, next: S.Approved });
});

test("duyệt: mẫu Nháp / Đã duyệt không duyệt được", () => {
  for (const status of [S.Draft, S.Approved, S.Returned, S.Archived]) {
    const result = decide({ action: "approve", canApprove: true, status });
    assert.equal(!result.ok && result.code, "conflict", `trạng thái ${status}`);
  }
});

test("trả lại: thiếu ghi chú hoặc ngắn hơn 5 ký tự → validation", () => {
  for (const note of [undefined, "", "  ngắn ", "abcd"]) {
    const result = decide({ action: "return", canApprove: true, status: S.PendingReview, note });
    assert.equal(!result.ok && result.code, "validation", String(note));
  }
});

test("trả lại: ghi chú dài hơn 500 ký tự bị từ chối", () => {
  const result = decide({ action: "return", canApprove: true, status: S.PendingReview, note: "a".repeat(501) });
  assert.equal(!result.ok && result.code, "validation");
});

test("trả lại: ghi chú hợp lệ → Trả lại", () => {
  assert.deepEqual(decide({ action: "return", canApprove: true, status: S.PendingReview, note: "Thiếu hạn báo giá" }), { ok: true, next: S.Returned });
});

test("ngừng dùng: cần quyền duyệt; mọi trạng thái trừ đã ngừng", () => {
  assert.equal(decide({ action: "archive", status: S.Approved }).ok, false);
  for (const status of [S.Draft, S.PendingReview, S.Approved, S.Returned]) {
    assert.deepEqual(decide({ action: "archive", canApprove: true, status }), { ok: true, next: S.Archived });
  }
  const again = decide({ action: "archive", canApprove: true, status: S.Archived });
  assert.equal(!again.ok && again.code, "conflict");
});

test("validateTemplateInput: chuẩn hóa từ khóa (bỏ trùng, bỏ rỗng)", () => {
  const input = validateTemplateInput({ name: " Báo giá ", body: "Dạ em gửi anh chị bảng giá [giá]", keywords: "giá, báo giá, giá, ", tone: 2, situation: "Hỏi giá" });
  assert.equal(input.name, "Báo giá");
  assert.deepEqual(input.keywords, ["giá", "báo giá"]);
  assert.equal(input.tone, 2);
});

test("validateTemplateInput: tên ngắn / nội dung ngắn / quá 20 từ khóa / tông sai → validation", () => {
  const ok = { name: "Báo giá", body: "Nội dung đủ dài rồi", keywords: [], tone: 1 };
  const bad = [
    { ...ok, name: "ab" }, { ...ok, body: "ngắn" }, { ...ok, body: "x".repeat(2001) },
    { ...ok, keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) }, { ...ok, tone: 9 },
  ];
  for (const raw of bad) {
    assert.throws(() => validateTemplateInput(raw), (error: unknown) => error instanceof ReplyTemplateError && error.code === "validation");
  }
});
