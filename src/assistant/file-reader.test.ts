import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import { Readable } from "node:stream";
import { AttachmentStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { AttachmentTextRecord, AttachmentTextSave, AttachmentTextStore } from "../storage/attachment-text-sql-cache.js";
import type { FileStorage } from "../storage/file-storage.js";
import { audioMimeFor, classifyForReading, extensionOf, extractDocx, extractSheet, isRetryableFileSourceUrl, MAX_SHEET_ROWS, readAttachmentText, withAttachmentTextStore } from "./file-reader.js";

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

// 06/10/2026: quản trị chọn loại tệp bot được đọc; ghi âm thì nghe (gỡ băng), video thì không đọc
test("classifies audio, video and documents, and applies the admin's allow list", () => {
  const allowed = ["pdf", "docx", "mp3"];
  assert.deepEqual(classifyForReading("mp3", allowed), { kind: "audio", allowed: true });
  assert.deepEqual(classifyForReading("m4a", allowed), { kind: "audio", allowed: false });
  assert.deepEqual(classifyForReading("mp4", allowed), { kind: "video", allowed: false });
  assert.deepEqual(classifyForReading("mp4", ["mp4"]), { kind: "video", allowed: true }); // vẫn bị chặn ở readAttachmentText vì là video
  assert.deepEqual(classifyForReading("xlsx", allowed), { kind: "sheet", allowed: false });
  assert.deepEqual(classifyForReading("docx", allowed), { kind: "docx", allowed: true });
  assert.deepEqual(classifyForReading("jpg", []), { kind: "image", allowed: true }); // danh sách rỗng = mọi loại
  assert.deepEqual(classifyForReading("exe", undefined), { kind: "unknown", allowed: true });
  assert.deepEqual(classifyForReading("", allowed), { kind: "unknown", allowed: false });
});

// 10/10/2026: read_link tải ghi âm Drive — biết loại qua content-type HOẶC đuôi trong Content-Disposition (Drive hay trả octet-stream chung chung)
test("audioMimeFor: nhận ra âm thanh qua content-type chuẩn, qua đuôi tên tệp khi content-type chung chung, và loại không phải âm thanh", () => {
  assert.deepEqual(audioMimeFor("audio/mpeg", "ghi-am.mp3"), { mime: "audio/mpeg", ext: "mp3" });
  // Drive trả application/octet-stream — phải đoán theo đuôi tên tệp trong Content-Disposition
  assert.deepEqual(audioMimeFor("application/octet-stream", "cuoc-hop-10-10.m4a"), { mime: "audio/mp4", ext: "m4a" });
  // content-type chuẩn hóa khác bảng (audio/mp4 thay vì theo đuôi) nhưng tên tệp không có đuôi rõ
  assert.deepEqual(audioMimeFor("audio/mp4; charset=binary", "tep-khong-duoi"), { mime: "audio/mp4", ext: "m4a" });
  // audio/* lạ, không khớp bảng, không có đuôi — vẫn nhận là âm thanh (coi như mp3 để báo người dùng)
  assert.deepEqual(audioMimeFor("audio/x-la-chua-biet", ""), { mime: "audio/x-la-chua-biet", ext: "mp3" });
  assert.equal(audioMimeFor("application/octet-stream", "bao-cao.xlsx"), null);
  assert.equal(audioMimeFor("video/mp4", "clip.mp4"), null);
});

// Phase 6 (10/10/2026): read_file tự tải lại tệp Skip/Failed/Pending còn link Zalo — chỉ thử khi link còn tải lại được.
test("isRetryableFileSourceUrl: chỉ nhận link http(s), không nhận data: URL / rỗng / thiếu", () => {
  assert.equal(isRetryableFileSourceUrl("https://tcareer.zdn.vn/file/abc"), true);
  assert.equal(isRetryableFileSourceUrl("http://tcareer.zdn.vn/file/abc"), true);
  assert.equal(isRetryableFileSourceUrl("data:image/png;base64,abc"), false);
  assert.equal(isRetryableFileSourceUrl(""), false);
  assert.equal(isRetryableFileSourceUrl(null), false);
  assert.equal(isRetryableFileSourceUrl(undefined), false);
});

test("ảnh Zalo không tên (đuôi điền bù «jpg») nhưng ruột là PNG: báo mô hình image/png, cất chữ đã đọc", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
  const inserts: unknown[][] = [];
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.startsWith("INSERT")) {
        inserts.push(params ?? []);
        return [{ affectedRows: 1 }];
      }
      return [[{ id: 20, file_name: "", file_ext: "jpg", status: AttachmentStatus.Stored, storage_key: "k/20-tep.bin", stored_bytes: png.length,
        method: null, summary: null, text: null, char_count: null }]];
    },
  } as unknown as Db;
  const storage = { read: async () => Readable.from([png]) } as unknown as FileStorage;
  const seenMimes: string[] = [];
  const result = await readAttachmentText({
    db, storage, maxFileBytes: 5 * 1024 * 1024, allowedExtensions: ["jpg", "png"],
    readDocument: async (mime) => {
      seenMimes.push(mime);
      return { text: "HÓA ĐƠN 123\nMô tả: hóa đơn bán hàng", inputTokens: 10, outputTokens: 5 };
    },
  }, 20);
  assert.deepEqual(seenMimes, ["image/png"]);
  assert.ok(!("error" in result));
  assert.equal(result.fileName, "tep.jpg");
  assert.equal(result.summary, "ảnh (mô hình đọc)");
  assert.equal(inserts.length, 1);
});

// Phase 7 (họ files): kho chữ tiêm được — `readAttachmentText` không còn tự chạm SQL; trợ lý áp kho MCP cho cả lượt bằng `withAttachmentTextStore`
const noDb = { query: async () => { throw new Error("không được chạm DB khi đã có kho tiêm"); } } as unknown as Db;

function memoryStore(record: AttachmentTextRecord | null) {
  const saved: { id: number; data: AttachmentTextSave }[] = [];
  const store: AttachmentTextStore = { load: async () => record, save: async (id, data) => { saved.push({ id, data }); } };
  return { store, saved };
}

const csvRecord = (overrides: Partial<AttachmentTextRecord> = {}): AttachmentTextRecord =>
  ({ attachmentId: 30, fileName: "bang.csv", fileExt: "csv", status: AttachmentStatus.Stored, storageKey: "k/30", storedBytes: 5, cached: null, ...overrides });

test("kho tiêm: tệp chưa bóc → bóc rồi GHI qua store.save (không SQL); lần sau có cache thì không bóc lại", async () => {
  const storage = { read: async () => Readable.from([Buffer.from("a,b\n1,2")]) } as unknown as FileStorage;
  const first = memoryStore(csvRecord());
  const result = await readAttachmentText({ db: noDb, store: first.store, storage, maxFileBytes: 1024 }, 30);
  assert.ok(!("error" in result) && result.text.includes("a,b") && !result.cached);
  assert.equal(first.saved.length, 1);
  assert.equal(first.saved[0].data.method, "text");
  const cachedStore = memoryStore(csvRecord({ cached: { method: "text", summary: "csv", text: "đã có", charCount: 5 } }));
  const again = await readAttachmentText({ db: noDb, store: cachedStore.store, storage: { read: async () => { throw new Error("không đọc kho"); } } as unknown as FileStorage, maxFileBytes: 1024 }, 30);
  assert.ok(!("error" in again) && again.cached && again.text === "đã có");
  assert.equal(cachedStore.saved.length, 0);
});

test("kho tiêm: tệp không có / chưa vào kho / đuôi bị chặn báo như cũ; unsupported ghi text null", async () => {
  const deps = { db: noDb, storage: {} as FileStorage, maxFileBytes: 1024 };
  assert.deepEqual(await readAttachmentText({ ...deps, store: memoryStore(null).store }, 9), { error: "Không có tệp #9" });
  const skipped = await readAttachmentText({ ...deps, store: memoryStore(csvRecord({ status: AttachmentStatus.Skipped, storageKey: null })).store }, 30);
  assert.match(String((skipped as { error: string }).error), /chưa có trong kho/);
  const blocked = await readAttachmentText({ ...deps, store: memoryStore(csvRecord()).store, allowedExtensions: ["pdf"] }, 30);
  assert.match(String((blocked as { error: string }).error), /chưa được phép đọc tệp \.csv/);
  const unsupported = memoryStore(csvRecord({ fileName: "x.bin", fileExt: "bin" }));
  const outcome = await readAttachmentText({ ...deps, store: unsupported.store, storage: { read: async () => Readable.from([Buffer.from("x")]) } as unknown as FileStorage }, 30);
  assert.match(String((outcome as { error: string }).error), /chưa đọc được đuôi \.bin/);
  assert.equal(unsupported.saved[0].data.text, null);
});

test("withAttachmentTextStore: kho áp cho cả lượt đè kho SQL mặc định; ngoài phạm vi thì quay lại SQL", async () => {
  const scoped = memoryStore(csvRecord({ cached: { method: "text", summary: "csv", text: "từ kho MCP", charCount: 10 } }));
  const deps = { db: noDb, storage: {} as FileStorage, maxFileBytes: 1024 };
  const inside = await withAttachmentTextStore(scoped.store, () => readAttachmentText(deps, 30));
  assert.ok(!("error" in inside) && inside.text === "từ kho MCP");
  await assert.rejects(readAttachmentText(deps, 30), /không được chạm DB/);
});
