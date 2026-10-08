import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MessageKind } from "../../constants.js";
import { buildContentDisposition, describeFileDownload } from "./file-download.js";

describe("tên + kiểu khi tải tệp trong kho", () => {
  // Lỗi 08/10/2026: ảnh chat.photo (không tên, không đuôi) tải về thành «8-tep.bin», ?inline=1 không vẽ được ảnh
  test("a chat.photo without name or extension downloads as a jpg image, not 8-tep.bin", () => {
    const info = describeFileDownload({ id: 8, fileName: "", fileExt: "", messageKind: MessageKind.Image, storageKey: "g1/2026-10/8-tep.bin" });
    assert.equal(info.fileName, "anh-8.jpg");
    assert.equal(info.imageType, "image/jpeg");
  });

  test("a photo with a recorded png extension keeps png", () => {
    const info = describeFileDownload({ id: 9, fileName: null, fileExt: "PNG", messageKind: MessageKind.Image, storageKey: "g1/2026-10/9-tep.png" });
    assert.equal(info.fileName, "anh-9.png");
    assert.equal(info.imageType, "image/png");
  });

  test("a named document keeps its original Vietnamese name and is not an inline image", () => {
    const info = describeFileDownload({ id: 3, fileName: "Báo giá tháng 10.xlsx", fileExt: "xlsx", messageKind: MessageKind.File, storageKey: "g/2026-10/3-Báo giá tháng 10.xlsx" });
    assert.equal(info.fileName, "Báo giá tháng 10.xlsx");
    assert.equal(info.imageType, null);
  });

  test("a name without extension gets the recorded extension appended", () => {
    assert.equal(describeFileDownload({ id: 4, fileName: "hop-dong", fileExt: "pdf", messageKind: MessageKind.File, storageKey: "k/4-hop-dong.pdf" }).fileName, "hop-dong.pdf");
  });

  test("path separators and quotes in the stored name cannot escape the header or the folder", () => {
    const info = describeFileDownload({ id: 5, fileName: '../../etc/"passwd"\r\nX-Evil: 1', fileExt: "", messageKind: MessageKind.File, storageKey: "k/5-x" });
    assert.ok(!info.fileName.includes("/"));
    assert.ok(!info.fileName.includes('"'));
    assert.ok(!/[\r\n]/.test(info.fileName));
    const header = buildContentDisposition(info.fileName, false);
    assert.ok(!/[\r\n]/.test(header));
  });

  test("an svg is never served inline even if the message is an image", () => {
    const info = describeFileDownload({ id: 6, fileName: "logo.svg", fileExt: "svg", messageKind: MessageKind.Image, storageKey: "k/6-logo.svg" });
    assert.equal(info.imageType, null);
    assert.equal(info.fileName, "logo.svg");
  });

  test("an unknown kind with nothing to go on falls back to tep-<id>.bin", () => {
    assert.equal(describeFileDownload({ id: 7, fileName: null, fileExt: null, messageKind: null, storageKey: "k/7-tep.bin" }).fileName, "tep-7.bin");
  });

  test("a video without a name downloads as mp4", () => {
    assert.equal(describeFileDownload({ id: 10, fileName: "", fileExt: "", messageKind: MessageKind.Video, storageKey: "k/10-tep.bin" }).fileName, "video-10.mp4");
  });

  test("content-disposition carries an ASCII fallback and an RFC 5987 UTF-8 name", () => {
    assert.equal(buildContentDisposition("Ảnh (1).jpg", true),
      `inline; filename="_nh (1).jpg"; filename*=UTF-8''%E1%BA%A2nh%20%281%29.jpg`);
  });
});
