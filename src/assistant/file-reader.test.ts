import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import { extensionOf, extractDocx, extractSheet, MAX_SHEET_ROWS } from "./file-reader.js";

function docxOf(xml: string): Buffer {
  const name = Buffer.from("word/document.xml");
  const payload = deflateRawSync(Buffer.from(xml, "utf8"));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(payload.length, 18); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(payload.length, 20); central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(local.length + name.length + payload.length, 16);
  return Buffer.concat([local, name, payload, central, name, eocd]);
}

test("docx: mỗi đoạn một dòng, ô bảng nối bằng ' | ', chữ chạy nhiều <w:t> trong một đoạn được ghép liền", () => {
  const xml = `<w:document><w:body>
    <w:p><w:r><w:t>Nhu </w:t></w:r><w:r><w:t>cầu &amp; mục tiêu</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:t>Hạng mục</w:t></w:p></w:tc><w:tc><w:p><w:t>Số lượng</w:t></w:p></w:tc></w:tr></w:tbl>
    <w:p/></w:body></w:document>`;
  assert.equal(extractDocx(docxOf(xml)), "Nhu cầu & mục tiêu\nHạng mục | Số lượng");
});

test("xlsx: bỏ dòng trống, đếm dòng từng sheet, cắt ở MAX_SHEET_ROWS và nói rõ đã cắt", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Tên", "SL"], ["Phân bón", 10], [], ["Thuốc", 2.5]]), "Nhu cầu");
  const big = Array.from({ length: MAX_SHEET_ROWS + 5 }, (_, index) => [`dòng ${index}`]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(big), "Lớn");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const { text, summary } = extractSheet(buffer);
  assert.match(text, /### Sheet Nhu cầu\nTên \| SL\nPhân bón \| 10\nThuốc \| 2\.5/);
  assert.equal(summary, `Nhu cầu: 3 dòng; Lớn: ${MAX_SHEET_ROWS + 5} dòng`);
  // Sheet thứ hai chỉ còn chỗ cho MAX_SHEET_ROWS - 3 dòng
  assert.match(text, new RegExp(`chỉ lấy ${MAX_SHEET_ROWS - 3}/${MAX_SHEET_ROWS + 5} dòng đầu`));
  assert.ok(!text.includes(`dòng ${MAX_SHEET_ROWS - 3}\n`) || text.split("\n").length <= MAX_SHEET_ROWS + 10);
});

test("đuôi tệp: ưu tiên cột file_ext, rơi về tên tệp, không phân biệt hoa thường", () => {
  assert.equal(extensionOf("Báo giá.XLSX", ""), "xlsx");
  assert.equal(extensionOf("tep", "pdf"), "pdf");
  assert.equal(extensionOf("khong-duoi", ""), "");
});

test("tệp .xlsx nhưng ruột là chữ thường: SheetJS đọc như CSV — vẫn ra chữ chứ không ném lỗi", () => {
  const { text } = extractSheet(Buffer.from("a,b\n1,2"));
  assert.match(text, /a \| b\n1 \| 2/);
});
