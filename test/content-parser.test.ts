import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageKind } from "../src/constants.js";
import { parseZaloContent } from "../src/zalo/content-parser.js";

test("tin chữ giữ nguyên nội dung, không có tệp", () => {
  const parsed = parseZaloContent("webchat", "Chiều nay gửi báo giá nhé");
  assert.equal(parsed.kind, MessageKind.Text);
  assert.equal(parsed.text, "Chiều nay gửi báo giá nhé");
  assert.equal(parsed.attachment, null);
});

test("tệp: lấy tên, đuôi, cỡ từ params là CHUỖI JSON lồng bên trong", () => {
  const parsed = parseZaloContent("share.file", {
    title: "Bao gia DL Thanh Cong.xlsx",
    href: "https://f1.zdn.vn/abc/Bao-gia.xlsx",
    params: JSON.stringify({ fileSize: "20480", fileExt: "XLSX" }),
  });
  assert.equal(parsed.kind, MessageKind.File);
  assert.equal(parsed.text, "Bao gia DL Thanh Cong.xlsx");
  assert.deepEqual(parsed.attachment, {
    url: "https://f1.zdn.vn/abc/Bao-gia.xlsx",
    fileName: "Bao gia DL Thanh Cong.xlsx",
    fileExt: "xlsx",
    declaredSize: 20480,
  });
});

test("ảnh: ưu tiên bản nét params.hd, chú thích vào text", () => {
  const parsed = parseZaloContent("chat.photo", {
    title: "Hàng về kho",
    href: "https://photo.zdn.vn/thumb.jpg",
    params: JSON.stringify({ hd: "https://photo.zdn.vn/hd.jpg" }),
  });
  assert.equal(parsed.kind, MessageKind.Image);
  assert.equal(parsed.text, "Hàng về kho");
  assert.equal(parsed.attachment?.url, "https://photo.zdn.vn/hd.jpg");
});

test("biến thể msgType (chat.video.msg) vẫn nhận ra video", () => {
  const parsed = parseZaloContent("chat.video.msg", { href: "https://v.zdn.vn/a.mp4", params: "{}" });
  assert.equal(parsed.kind, MessageKind.Video);
  assert.equal(parsed.attachment?.url, "https://v.zdn.vn/a.mp4");
});

test("sticker không tải tệp — đó là ảnh của Zalo, không phải tài liệu", () => {
  const parsed = parseZaloContent("chat.sticker", { id: 123, catId: 4, type: 7 });
  assert.equal(parsed.kind, MessageKind.Sticker);
  assert.equal(parsed.attachment, null);
});

test("link chia sẻ: chat.recommended + action link, gom tiêu đề + mô tả + đường dẫn", () => {
  const parsed = parseZaloContent("chat.recommended", {
    action: "recommened.link",
    title: "Thông tư 01",
    description: "Văn bản mới",
    href: "https://thuvienphapluat.vn/x",
  });
  assert.equal(parsed.kind, MessageKind.Link);
  assert.equal(parsed.text, "Thông tư 01\nVăn bản mới\nhttps://thuvienphapluat.vn/x");
  assert.equal(parsed.attachment, null);
});

test("danh thiếp: chat.recommended + action user", () => {
  assert.equal(parseZaloContent("chat.recommended", { action: "recommened.user", title: "A" }).kind, MessageKind.Contact);
});

test("loại lạ không đoán bừa: Other, params hỏng không làm nổ", () => {
  const parsed = parseZaloContent("chat.todo", { title: "Gửi báo cáo", params: "{không phải json" });
  assert.equal(parsed.kind, MessageKind.Other);
  assert.equal(parsed.text, "Gửi báo cáo");
  assert.equal(parsed.attachment, null);
});

test("tệp thiếu href thì không có gì để tải", () => {
  assert.equal(parseZaloContent("share.file", { title: "x.pdf", params: "{}" }).attachment, null);
});

test("tệp không khai fileExt: lấy đuôi từ tên", () => {
  const parsed = parseZaloContent("share.file", { title: "Hop dong.PDF", href: "https://f.zdn.vn/1", params: "{}" });
  assert.equal(parsed.attachment?.fileExt, "pdf");
});
