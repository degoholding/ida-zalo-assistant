import assert from "node:assert/strict";
import { test } from "node:test";
import { sniffImageType } from "./image-type-sniff.js";

test("sniffImageType: nhận jpg / png / gif / webp theo chữ ký đầu tệp", () => {
  assert.deepEqual(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xdb])), { ext: "jpg", mime: "image/jpeg" });
  assert.deepEqual(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])), { ext: "png", mime: "image/png" });
  assert.deepEqual(sniffImageType(Buffer.from("GIF89a....", "latin1")), { ext: "gif", mime: "image/gif" });
  assert.deepEqual(sniffImageType(Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "latin1")), { ext: "webp", mime: "image/webp" });
});

test("sniffImageType: không phải ảnh / tệp quá ngắn → null", () => {
  assert.equal(sniffImageType(Buffer.from("%PDF-1.7")), null);
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8])), null);
  assert.equal(sniffImageType(Buffer.alloc(0)), null);
});
