import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageKind } from "../constants.js";
import { attachmentLabel } from "../assistant/tools.js";
import { imageReviewText } from "./ai-review.js";
import { autoReadableImageExtensions, failedAttempts } from "./image-auto-read.js";

test("autoReadableImageExtensions: giao với «Loại tệp bot được đọc», rỗng = mọi đuôi ảnh", () => {
  assert.deepEqual(autoReadableImageExtensions([]), ["jpg", "jpeg", "png", "webp"]);
  assert.deepEqual(autoReadableImageExtensions(["pdf", "png", "jpg"]), ["jpg", "png"]);
  assert.deepEqual(autoReadableImageExtensions(["pdf", "xlsx"]), []);
});

test("failedAttempts: đếm lần hỏng từ summary, chưa hỏng = 0", () => {
  assert.equal(failedAttempts(null), 0);
  assert.equal(failedAttempts("xlsx: 2 dòng"), 0);
  assert.equal(failedAttempts("tự đọc ảnh lỗi lần 2: Gemini 503"), 2);
});

test("imageReviewText: chú thích + [Ảnh: …], che SĐT TRƯỚC khi cắt, dài quá giữ đầu + dòng mô tả ở cuối", () => {
  assert.equal(imageReviewText("", "HÓA ĐƠN\nMô tả: hóa đơn"), "[Ảnh: HÓA ĐƠN Mô tả: hóa đơn]");
  assert.equal(imageReviewText(" anh xem ", "ảnh"), "anh xem [Ảnh: ảnh]");
  const long = imageReviewText("", `${"x".repeat(2000)} Mô tả: bao phân vón cục`);
  assert.ok(long.length <= 520);
  assert.match(long, / … .*Mô tả: bao phân vón cục\]$/);
  // SĐT nằm ngay chỗ cắt: vẫn bị che, không lọt nửa số
  const phone = imageReviewText("", `${"y".repeat(330)} SĐT 0912 345 678 ${"z".repeat(300)}`);
  assert.doesNotMatch(phone, /0912|345 678/);
});

test("attachmentLabel: tệp có tên / ảnh đã đọc (che SĐT, cắt 300) / ảnh chưa đọc / tệp không tên", () => {
  assert.equal(attachmentLabel({ kind: MessageKind.File, file_name: "Bao gia.xlsx", attachment_id: 12, file_text: null }), "[tệp #12: Bao gia.xlsx]");
  assert.equal(attachmentLabel({ kind: MessageKind.Image, file_name: "", attachment_id: 20, file_text: "HÓA ĐƠN\n123" }), "[ảnh #20: HÓA ĐƠN 123]");
  assert.equal(attachmentLabel({ kind: MessageKind.Image, file_name: "", attachment_id: 21, file_text: null }), "[ảnh #21]");
  assert.equal(attachmentLabel({ kind: MessageKind.Video, file_name: "", attachment_id: 22, file_text: null }), "[tệp #22]");
  assert.doesNotMatch(attachmentLabel({ kind: MessageKind.Image, file_name: "", attachment_id: 24, file_text: `${"a".repeat(290)} 0909123456` }), /0909/);
  const long = attachmentLabel({ kind: MessageKind.Image, file_name: "", attachment_id: 23, file_text: "a".repeat(500) });
  assert.equal(long.length, "[ảnh #23: ".length + 300 + 1);
});
