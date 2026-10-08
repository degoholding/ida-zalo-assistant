import type { RowDataPacket } from "mysql2";
import * as XLSX from "xlsx";
import { AttachmentStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { FileStorage } from "../storage/file-storage.js";
import { readZipEntry } from "./zip-reader.js";

// Bóc chữ từ tệp trong kho cho bot đọc: txt / csv / xlsx / docx tự bóc; pdf / ảnh nhờ mô hình đọc; ghi âm (mp3, m4a…)
// nhờ mô hình nghe — gỡ băng + tóm tắt (06/10/2026). Video (mp4…) không đọc. Loại nào được đọc do cài đặt «Loại tệp bot
// được đọc» quyết (FileReaderDeps.allowedExtensions).
// Kết quả CẤT vào attachment_text — đọc một lần, lần sau tìm và tóm tắt dùng lại (và màn Tệp tìm được).

export type ExtractMethod = "text" | "xlsx" | "docx" | "gemini" | "unsupported";

export interface ExtractedText {
  method: ExtractMethod;
  text: string;
  summary: string;
  inputTokens: number;
  outputTokens: number;
}

/** Mô hình đọc tài liệu (pdf, ảnh): nhận nhị phân, trả chữ. Không có = chỉ đọc được tệp văn bản. */
export type DocumentReader = (mime: string, data: Buffer, instruction: string) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;

export interface FileReaderDeps {
  db: Db;
  storage: FileStorage;
  readDocument?: DocumentReader;
  maxFileBytes: number;
  /** Đuôi tệp được phép đọc (chữ thường, không dấu chấm). Bỏ trống / undefined = mọi loại bot đọc được. */
  allowedExtensions?: string[];
  /** Bóc xlsx / docx ở luồng phụ (src/cpu/cpu-pool.ts) để không đứng luồng chính; bỏ trống = bóc ngay tại chỗ. */
  heavyExtract?: HeavyExtractor;
}

/** Bóc chữ tệp nặng CPU ở nơi khác (luồng phụ). */
export type HeavyExtractor = (task: "sheet" | "docx", data: Buffer) => Promise<{ text: string; summary: string }>;

/** Số dòng bảng tính tối đa đưa cho mô hình — quá là tốn token mà không đọc hết được. */
export const MAX_SHEET_ROWS = 2000;
/** Chữ bóc ra cất tối đa ngần này ký tự (MEDIUMTEXT chứa thoải mái, nhưng prompt thì không). */
export const MAX_TEXT_CHARS = 200_000;

const TEXT_EXTENSIONS = new Set(["txt", "csv", "md", "json", "xml", "html", "htm", "log", "tsv"]);
const SHEET_EXTENSIONS = new Set(["xlsx", "xlsm", "xls", "ods"]);
const IMAGE_MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const AUDIO_MIME: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac" };
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "webm", "3gp", "wmv", "flv"]);

export type FileKind = "text" | "sheet" | "docx" | "pdf" | "image" | "audio" | "video" | "unknown";

/** Loại tệp theo đuôi + bot có được phép đọc không (theo cài đặt). Hàm thuần. */
export function classifyForReading(ext: string, allowed?: string[]): { kind: FileKind; allowed: boolean } {
  const kind: FileKind = TEXT_EXTENSIONS.has(ext) ? "text" : SHEET_EXTENSIONS.has(ext) ? "sheet" : ext === "docx" ? "docx"
    : ext === "pdf" ? "pdf" : IMAGE_MIME[ext] ? "image" : AUDIO_MIME[ext] ? "audio" : VIDEO_EXTENSIONS.has(ext) ? "video" : "unknown";
  return { kind, allowed: !allowed?.length || allowed.includes(ext) };
}

const DOCUMENT_INSTRUCTION =
  "Chép lại TOÀN BỘ chữ có trong tài liệu này theo đúng thứ tự, giữ bảng dưới dạng từng dòng, các ô cách nhau bằng ' | '. " +
  "Không tóm tắt, không bình luận, không thêm chữ nào ngoài nội dung tài liệu. Chữ viết tay / mờ không đọc được thì ghi [không đọc được].";
// Phần tóm tắt + phân công đặt TRƯỚC bản gỡ băng: cuộc họp dài thì chữ đưa cho mô hình bị cắt ở cuối — vẫn còn phần quan trọng
export const AUDIO_INSTRUCTION =
  "Đây là ghi âm gửi trong nhóm làm việc (thường là cuộc họp). Trả lời bằng tiếng Việt, đúng 4 phần theo thứ tự:\n" +
  "TÓM TẮT: 3–6 câu nêu nội dung chính.\n" +
  "QUYẾT ĐỊNH: các điều đã chốt (không có thì ghi 'không có').\n" +
  "PHÂN CÔNG: mỗi dòng 'Người — việc — hạn'; chỉ ghi người / hạn khi trong ghi âm có nói, không rõ thì ghi '(chưa rõ)'.\n" +
  "GỠ BĂNG: toàn bộ lời nói theo thứ tự; phân biệt được nhiều người thì ghi tên (nếu được gọi tên) hoặc 'Người 1:', 'Người 2:'; " +
  "đoạn không nghe rõ ghi [không nghe rõ].\nKhông bịa lời không có trong ghi âm.";
const IMAGE_INSTRUCTION =
  "Đây là ảnh gửi trong nhóm làm việc. Nếu ảnh có chữ (hóa đơn, báo giá, chụp màn hình, biển hiệu…) thì chép lại toàn bộ chữ theo đúng thứ tự, " +
  "bảng giữ dạng từng dòng, các ô cách nhau bằng ' | '. Sau đó thêm một dòng 'Mô tả: …' tả ngắn gọn ảnh có gì (bằng tiếng Việt). Không bịa chữ không có trong ảnh.";

export function extensionOf(fileName: string, fileExt: string): string {
  const fromName = /\.([a-z0-9]{1,10})$/i.exec(fileName)?.[1];
  return (fileExt || fromName || "").toLowerCase();
}

function decodeXmlText(fragment: string): string {
  return fragment
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .trim();
}

/** Bóc chữ docx: mỗi đoạn <w:p> một dòng; hàng bảng <w:tr> thành một dòng, các ô cách nhau bằng ' | '. */
export function extractDocx(buffer: Buffer): string {
  const xml = readZipEntry(buffer, "word/document.xml");
  if (!xml) throw new Error("docx thiếu word/document.xml");
  // Hàng bảng gom trước thành một đoạn thuần chữ, rồi mới tách đoạn chung
  const body = xml.toString("utf8").replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (row) => {
    const cells = row.split("</w:tc>").map(decodeXmlText).filter(Boolean);
    return `<w:p>${cells.join(" | ")}</w:p>`;
  });
  const lines: string[] = [];
  for (const paragraph of body.split(/<\/w:p>/)) {
    const text = decodeXmlText(paragraph);
    if (text) lines.push(text);
  }
  return lines.join("\n").trim();
}

/** Bóc chữ bảng tính: mỗi sheet một khối, mỗi dòng các ô cách nhau bằng ' | ', tối đa MAX_SHEET_ROWS dòng cả tệp. */
export function extractSheet(buffer: Buffer): { text: string; summary: string } {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const blocks: string[] = [];
  const counts: string[] = [];
  let remaining = MAX_SHEET_ROWS;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
    const nonEmpty = rows.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
    counts.push(`${name}: ${nonEmpty.length} dòng`);
    if (remaining <= 0) continue;
    const taken = nonEmpty.slice(0, remaining);
    remaining -= taken.length;
    // Ô trống cuối dòng bỏ đi («A |  |  | » → «A»), ô trống giữa giữ để cột không xô lệch
    const lines = taken.map((row) => row.map((cell) => String(cell ?? "").trim()).join(" | ").replace(/(\s*\|\s*)+$/, ""));
    blocks.push(`### Sheet ${name}${nonEmpty.length > taken.length ? ` (chỉ lấy ${taken.length}/${nonEmpty.length} dòng đầu)` : ""}\n${lines.join("\n")}`);
  }
  return { text: blocks.join("\n\n"), summary: counts.join("; ").slice(0, 500) };
}

async function extract(deps: FileReaderDeps, file: { file_name: string; file_ext: string; data: Buffer }): Promise<ExtractedText> {
  const ext = extensionOf(file.file_name, file.file_ext);
  const zero = { inputTokens: 0, outputTokens: 0 };
  if (TEXT_EXTENSIONS.has(ext)) {
    let text = file.data.toString("utf8");
    if (ext === "html" || ext === "htm") text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ");
    return { method: "text", text: text.trim(), summary: `${ext}, ${text.length} ký tự`, ...zero };
  }
  if (SHEET_EXTENSIONS.has(ext)) {
    const { text, summary } = deps.heavyExtract ? await deps.heavyExtract("sheet", file.data) : extractSheet(file.data);
    return { method: "xlsx", text, summary, ...zero };
  }
  if (ext === "docx") {
    const text = deps.heavyExtract ? (await deps.heavyExtract("docx", file.data)).text : extractDocx(file.data);
    return { method: "docx", text, summary: "docx", ...zero };
  }
  if (VIDEO_EXTENSIONS.has(ext)) return { method: "unsupported", text: "", summary: `không đọc video (.${ext})`, ...zero };
  const mime = ext === "pdf" ? "application/pdf" : IMAGE_MIME[ext] ?? AUDIO_MIME[ext];
  if (mime && deps.readDocument) {
    const audio = Boolean(AUDIO_MIME[ext]);
    const instruction = ext === "pdf" ? DOCUMENT_INSTRUCTION : audio ? AUDIO_INSTRUCTION : IMAGE_INSTRUCTION;
    const result = await deps.readDocument(mime, file.data, instruction);
    const summary = ext === "pdf" ? "pdf (mô hình đọc)" : audio ? `ghi âm .${ext} (mô hình nghe, gỡ băng + tóm tắt)` : "ảnh (mô hình đọc)";
    return { method: "gemini", text: result.text.trim(), summary, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  }
  return { method: "unsupported", text: "", summary: `chưa đọc được đuôi .${ext || "?"}`, ...zero };
}

export interface ReadFileResult {
  attachmentId: number;
  fileName: string;
  method: ExtractMethod;
  summary: string;
  text: string;
  charCount: number;
  /** Đọc lần này (tốn token) hay lấy từ kho đã bóc. */
  cached: boolean;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Chữ của một tệp trong kho: có sẵn trong attachment_text thì trả ngay; chưa thì bóc rồi cất.
 * Tệp quá `maxFileBytes` hoặc chưa tải về kho thì báo rõ (không ném lỗi — mô hình cần câu để nói lại với người hỏi).
 */
export async function readAttachmentText(deps: FileReaderDeps, attachmentId: number): Promise<ReadFileResult | { error: string }> {
  const [rows] = await deps.db.query<RowDataPacket[]>(
    `SELECT a.id, a.file_name, a.file_ext, a.status, a.storage_key, a.stored_bytes,
            t.method, t.summary, t.text, t.char_count
     FROM attachment a LEFT JOIN attachment_text t ON t.attachment_id = a.id WHERE a.id = ?`, [attachmentId]);
  const row = rows[0];
  if (!row) return { error: `Không có tệp #${attachmentId}` };
  const fileName = String(row.file_name || `tep.${row.file_ext || "bin"}`);
  // Kiểm quyền TRƯỚC cả chữ đã bóc sẵn — quản trị vừa bỏ một loại khỏi danh sách thì bot thôi đọc ngay
  const ext = extensionOf(fileName, String(row.file_ext ?? ""));
  const access = classifyForReading(ext, deps.allowedExtensions);
  if (access.kind === "video") return { error: `Bot không đọc video (${fileName}).` };
  if (!access.allowed) {
    return { error: `Bot chưa được phép đọc tệp .${ext || "?"} (${fileName}) — quản trị bật ở Cài đặt → «Loại tệp bot được đọc». Đang cho đọc: ${deps.allowedExtensions!.join(", ")}.` };
  }
  if (row.text !== null && row.text !== undefined) {
    return { attachmentId, fileName, method: row.method, summary: String(row.summary), text: String(row.text), charCount: Number(row.char_count), cached: true, inputTokens: 0, outputTokens: 0 };
  }
  if (row.status !== AttachmentStatus.Stored || !row.storage_key) return { error: `Tệp «${fileName}» chưa có trong kho (chưa tải về hoặc nhóm không bật lấy file)` };
  if (Number(row.stored_bytes) > deps.maxFileBytes) {
    return { error: `Tệp «${fileName}» nặng ${Math.round(Number(row.stored_bytes) / 1024 / 1024)} MB, quá mức ${Math.round(deps.maxFileBytes / 1024 / 1024)} MB bot được đọc` };
  }
  const stream = await deps.storage.read(String(row.storage_key));
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const data = Buffer.concat(chunks);
  let extracted: ExtractedText;
  try {
    extracted = await extract(deps, { file_name: fileName, file_ext: String(row.file_ext ?? ""), data });
  } catch (error) {
    return { error: `Không đọc được «${fileName}»: ${error instanceof Error ? error.message : String(error)}` };
  }
  const text = extracted.text.slice(0, MAX_TEXT_CHARS);
  await deps.db.query(
    `INSERT INTO attachment_text (attachment_id, method, char_count, summary, text, input_tokens, output_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE method = VALUES(method), char_count = VALUES(char_count), summary = VALUES(summary), text = VALUES(text),
       input_tokens = VALUES(input_tokens), output_tokens = VALUES(output_tokens), extracted_at = CURRENT_TIMESTAMP(3)`,
    [attachmentId, extracted.method, text.length, extracted.summary.slice(0, 500), extracted.method === "unsupported" ? null : text,
      extracted.inputTokens, extracted.outputTokens]);
  if (extracted.method === "unsupported") {
    return { error: `Bot ${extracted.summary} (${fileName}). Đọc được: ${deps.allowedExtensions?.length ? deps.allowedExtensions.join(", ") : "xlsx, docx, pdf, txt, csv, ảnh, ghi âm (mp3, m4a…)"}.` };
  }
  return { attachmentId, fileName, method: extracted.method, summary: extracted.summary, text, charCount: text.length, cached: false,
    inputTokens: extracted.inputTokens, outputTokens: extracted.outputTokens };
}
