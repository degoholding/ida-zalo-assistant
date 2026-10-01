import { inflateRawSync } from "node:zlib";

// Đọc MỘT mục trong tệp zip (docx = zip chứa word/document.xml). Chỉ cần ngần này nên tự viết
// ~60 dòng thay vì thêm thư viện: dò bảng mục cuối tệp (central directory), tìm tên, giải nén.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export function listZipEntries(buffer: Buffer): string[] {
  return readCentralDirectory(buffer).map((entry) => entry.name);
}

/** Nội dung mục `name` (đường dẫn trong zip), null nếu không có. Ném lỗi nếu zip hỏng / nén lạ. */
export function readZipEntry(buffer: Buffer, name: string): Buffer | null {
  const entry = readCentralDirectory(buffer).find((item) => item.name === name);
  if (!entry) return null;
  if (buffer.readUInt32LE(entry.localOffset) !== LOCAL_SIGNATURE) throw new Error("zip hỏng: thiếu đầu mục");
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === METHOD_STORED) return Buffer.from(data);
  if (entry.method === METHOD_DEFLATE) return inflateRawSync(data);
  throw new Error(`zip dùng cách nén ${entry.method} chưa hỗ trợ`);
}

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function readCentralDirectory(buffer: Buffer): CentralEntry[] {
  // EOCD nằm cuối tệp, trước nó có thể là chú thích (tối đa 65535 byte)
  const minOffset = Math.max(0, buffer.length - 22 - 65_535);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("không phải tệp zip");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: CentralEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error("zip hỏng: bảng mục sai");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.push({ name, method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
