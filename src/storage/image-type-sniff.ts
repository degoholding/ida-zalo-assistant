// Nhận ra ảnh qua mấy byte đầu tệp — ảnh Zalo («chat.photo») tới không có tên / đuôi, CDN có lúc trả content-type
// application/octet-stream, nên lúc cất kho và lúc đưa cho mô hình đọc phải tự đoán từ chính nội dung tệp.

const IMAGE_SIGNATURES: { ext: string; mime: string; matches: (data: Buffer) => boolean }[] = [
  { ext: "jpg", mime: "image/jpeg", matches: (data) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
  { ext: "png", mime: "image/png", matches: (data) => data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "gif", mime: "image/gif", matches: (data) => data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString("latin1")) },
  { ext: "webp", mime: "image/webp", matches: (data) => data.length >= 12 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP" },
];

/** Đuôi + mime của ảnh theo chữ ký đầu tệp; không phải ảnh quen (jpg / png / gif / webp) thì null. */
export function sniffImageType(data: Buffer): { ext: string; mime: string } | null {
  const found = IMAGE_SIGNATURES.find((signature) => signature.matches(data));
  return found ? { ext: found.ext, mime: found.mime } : null;
}
