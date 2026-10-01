import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { listZipEntries, readZipEntry } from "./zip-reader.js";

// Bộ đóng zip tối giản cho bài kiểm (Node không có sẵn): đủ đầu mục, bảng mục, EOCD.
function buildZip(entries: { name: string; data: Buffer; deflate: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const payload = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, payload);
    centrals.push(central, name);
    offset += local.length + name.length + payload.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

test("đọc đúng mục nén deflate lẫn mục lưu thẳng, kể cả tên có tiếng Việt", () => {
  const zip = buildZip([
    { name: "word/document.xml", data: Buffer.from("<w:p><w:t>Xin chào</w:t></w:p>", "utf8"), deflate: true },
    { name: "ghi chú.txt", data: Buffer.from("thường", "utf8"), deflate: false },
  ]);
  assert.deepEqual(listZipEntries(zip), ["word/document.xml", "ghi chú.txt"]);
  assert.equal(readZipEntry(zip, "word/document.xml")!.toString("utf8"), "<w:p><w:t>Xin chào</w:t></w:p>");
  assert.equal(readZipEntry(zip, "ghi chú.txt")!.toString("utf8"), "thường");
  assert.equal(readZipEntry(zip, "khong-co"), null);
});

test("không phải zip (tệp xlsx giả, rỗng, rác) thì báo lỗi rõ, không treo", () => {
  assert.throws(() => readZipEntry(Buffer.from("PK rac"), "a"), /không phải tệp zip/);
  assert.throws(() => readZipEntry(Buffer.alloc(0), "a"), /không phải tệp zip/);
  assert.throws(() => readZipEntry(Buffer.alloc(100, 7), "a"), /không phải tệp zip/);
});
