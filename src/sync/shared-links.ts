import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { MessageKind, SharedLinkKind } from "../constants.js";
import type { Db } from "../db/pool.js";

// Link chia sẻ trong tin (phase 13.2): bóc URL http/https khỏi chữ của tin + thẻ link của Zalo, phân loại Google Drive / Sheets /
// Docs / Slides / thư mục / web khác, ghi bảng shared_link (migration 047). Gọi ở MỌI lần ghi tin thành công (tin mới, tin cũ bù
// lại, tin nhập, tin bot gửi ra) và ở lệnh nạp lại cho tin cũ (`backfillSharedLinks`). Chỉ đọc chữ đã có — không gọi mạng.

/** Trần độ dài URL lưu (cột url VARCHAR(2000) ascii). Dài hơn thì cắt — vẫn biết người gửi / nhóm / tên miền. */
export const MAX_URL_CHARS = 2000;
/** Trần số link một tin (tin dán cả trăm link thì chỉ giữ chừng này link đầu). */
export const MAX_LINKS_PER_MESSAGE = 50;
const MAX_TITLE_CHARS = 500;

export interface ExtractedLink {
  url: string;
  host: string;
  kind: SharedLinkKind;
  googleFileId: string | null;
  title: string | null;
}

// Ứng viên URL: từ http(s):// tới khoảng trắng / dấu ngoặc nhọn / nháy. Ký tự cuối câu cắt riêng ở `trimTrailing`.
const URL_CANDIDATE = /https?:\/\/[^\s<>"'`]+/gi;
// Ký tự hay dính sau link khi gõ câu: dấu câu, nháy cong, ngoặc kép góc, dấu ba chấm
const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", "…", "'", "’", "”", "»", "*"]);
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function count(text: string, char: string): number {
  let total = 0;
  for (const item of text) if (item === char) total += 1;
  return total;
}

/** Bỏ dấu câu dính cuối link; ngoặc đóng chỉ bỏ khi thừa (giữ link Wikipedia kiểu `..._(định_nghĩa)`). */
function trimTrailing(candidate: string): string {
  let value = candidate;
  for (;;) {
    const last = value.at(-1);
    if (!last) return value;
    if (TRAILING_PUNCTUATION.has(last)) {
      value = value.slice(0, -1);
      continue;
    }
    const opener = CLOSERS[last];
    if (opener && count(value, last) > count(value, opener)) {
      value = value.slice(0, -1);
      continue;
    }
    return value;
  }
}

// Google: chỉ hai máy này; id tệp 10+ ký tự [A-Za-z0-9_-]. `/d/e/<id>` = bản «xuất bản lên web»; `/u/1/` = tài khoản thứ hai.
const GOOGLE_DOC_PATH = /^\/(spreadsheets|document|presentation)(?:\/u\/\d+)?\/d\/(?:e\/)?([A-Za-z0-9_-]{10,})/;
const DRIVE_FILE_PATH = /^\/file(?:\/u\/\d+)?\/d\/([A-Za-z0-9_-]{10,})/;
const DRIVE_FOLDER_PATH = /^\/drive(?:\/u\/\d+)?\/(?:mobile\/)?folders\/([A-Za-z0-9_-]{10,})/;
const GOOGLE_ID = /^[A-Za-z0-9_-]{10,128}$/;
const DOC_KIND: Record<string, SharedLinkKind> = {
  spreadsheets: SharedLinkKind.GoogleSheets,
  document: SharedLinkKind.GoogleDocs,
  presentation: SharedLinkKind.GoogleSlides,
};

/** Loại link + id tệp Google (nếu có) từ URL đã chuẩn hóa. */
export function classifyLink(url: URL): { kind: SharedLinkKind; googleFileId: string | null } {
  const host = url.hostname;
  if (host === "docs.google.com") {
    const match = GOOGLE_DOC_PATH.exec(url.pathname);
    if (match) return { kind: DOC_KIND[match[1]], googleFileId: match[2].slice(0, 128) };
  }
  if (host === "drive.google.com") {
    const file = DRIVE_FILE_PATH.exec(url.pathname);
    if (file) return { kind: SharedLinkKind.GoogleDriveFile, googleFileId: file[1].slice(0, 128) };
    const folder = DRIVE_FOLDER_PATH.exec(url.pathname);
    if (folder) return { kind: SharedLinkKind.GoogleDriveFolder, googleFileId: folder[1].slice(0, 128) };
    // Kiểu cũ: drive.google.com/open?id=… và /uc?id=… (tải thẳng) — không biết tệp hay thư mục, coi là tệp
    const legacyId = url.searchParams.get("id");
    if ((url.pathname === "/open" || url.pathname === "/uc") && legacyId && GOOGLE_ID.test(legacyId)) {
      return { kind: SharedLinkKind.GoogleDriveFile, googleFileId: legacyId };
    }
  }
  return { kind: SharedLinkKind.Web, googleFileId: null };
}

/** Chuẩn hóa một ứng viên: phải là http/https có tên miền; trả null nếu không đọc được. */
export function normalizeLink(raw: string): { url: string; parsed: URL } | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) return null;
  // `href` của WHATWG URL: tên miền thường + punycode, đường dẫn mã hóa % — chỉ còn ASCII, khớp cột ascii
  return { url: parsed.href.slice(0, MAX_URL_CHARS), parsed };
}

/** Mọi URL http/https trong một đoạn chữ, đúng thứ tự, đã cắt dấu câu cuối (chưa chuẩn hóa, chưa bỏ trùng). */
export function findUrlCandidates(text: string): string[] {
  return [...text.matchAll(URL_CANDIDATE)].map((match) => trimTrailing(match[0])).filter((value) => /^https?:\/\/[^/?#]/i.test(value));
}

type Payload = Record<string, unknown>;

function parseParams(raw: unknown): Payload {
  if (raw && typeof raw === "object") return raw as Payload;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? (value as Payload) : {};
  } catch {
    return {};
  }
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Thẻ link của Zalo (tin `chat.link` / `chat.recommended` dạng link): URL ở `href` (có bản để ở `params.href` / `params.url`),
 * tiêu đề ở `title`. Chỉ với tin loại Link — tin tệp / ảnh cũng có `href` nhưng đó là đường tải tệp của Zalo, không phải link chia sẻ.
 */
function linkCard(kind: MessageKind, content: unknown): { href: string; title: string } | null {
  if (kind !== MessageKind.Link || !content || typeof content !== "object") return null;
  const payload = content as Payload;
  const params = parseParams(payload.params);
  const href = text(payload.href) || text(payload.url) || text(params.href) || text(params.url);
  return href ? { href, title: text(payload.title) } : null;
}

export interface LinkSource {
  /** Chữ của tin như đã lưu ở message.text (tin link: tiêu đề + mô tả + href). */
  text: string | null;
  kind: MessageKind;
  /** Nội dung thô của zca-js (message.raw_content) — để lấy thẻ link. */
  content?: unknown;
}

/** Bóc link của một tin: bỏ trùng trong tin, tối đa `MAX_LINKS_PER_MESSAGE`. Hàm thuần. */
export function extractSharedLinks(source: LinkSource): ExtractedLink[] {
  const card = linkCard(source.kind, source.content);
  const candidates = [...(card ? [card.href] : []), ...findUrlCandidates(source.text ?? "")];
  const cardUrl = card ? normalizeLink(card.href)?.url : undefined;
  const seen = new Set<string>();
  const links: ExtractedLink[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeLink(candidate);
    if (!normalized || seen.has(normalized.url)) continue;
    seen.add(normalized.url);
    const { kind, googleFileId } = classifyLink(normalized.parsed);
    const title = normalized.url === cardUrl && card?.title ? card.title.slice(0, MAX_TITLE_CHARS) : null;
    links.push({ url: normalized.url, host: normalized.parsed.hostname.slice(0, 255), kind, googleFileId, title });
    if (links.length >= MAX_LINKS_PER_MESSAGE) break;
  }
  return links;
}

export interface StoredMessageForLinks extends LinkSource {
  messageId: number;
  groupId: number;
  senderUid: string;
  senderName: string;
  sentAt: Date;
}

/** Ghi link của một tin (INSERT IGNORE theo UNIQUE message_id + url — chạy lại không trùng). Trả số dòng mới. */
export async function storeSharedLinks(db: Db, message: StoredMessageForLinks): Promise<number> {
  const links = extractSharedLinks(message);
  if (!links.length) return 0;
  const rows = links.map((link) => [
    message.messageId, message.groupId, link.url, link.host, link.kind, link.googleFileId, link.title,
    message.senderUid.slice(0, 40), message.senderName.slice(0, 255), message.sentAt,
  ]);
  const [result] = await db.query<ResultSetHeader>(
    `INSERT IGNORE INTO shared_link (message_id, group_id, url, host, kind, google_file_id, title, sender_uid, sender_name, sent_at)
     VALUES ?`,
    [rows],
  );
  return result.affectedRows;
}

/** Tin thu hồi: bỏ link của tin đó (cùng luật "bot không giữ lại chữ của tin đã thu hồi"). */
export async function deleteSharedLinksOfMessage(db: Db, messageId: number): Promise<void> {
  await db.query("DELETE FROM shared_link WHERE message_id = ?", [messageId]);
}

export interface BackfillResult {
  scanned: number;
  messagesWithLinks: number;
  inserted: number;
}

const BACKFILL_BATCH = 500;

/**
 * Nạp lại link cho tin ĐÃ có trong kho (trước 13.2): quét bảng message theo id tăng dần, từng lô, chỉ tin chưa thu hồi có chữ
 * "http" hoặc là thẻ link. Chạy lại bao nhiêu lần cũng không sinh trùng (INSERT IGNORE). `onProgress` báo sau mỗi lô.
 */
export async function backfillSharedLinks(
  db: Db,
  options: { batchSize?: number; fromId?: number; onProgress?: (lastId: number, result: BackfillResult) => void } = {},
): Promise<BackfillResult> {
  const batchSize = options.batchSize ?? BACKFILL_BATCH;
  const result: BackfillResult = { scanned: 0, messagesWithLinks: 0, inserted: 0 };
  let lastId = options.fromId ?? 0;
  for (;;) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, group_id, kind, sender_uid, sender_name, sent_at, text, raw_content FROM message
        WHERE id > ? AND recalled_at IS NULL AND (text LIKE '%http%' OR kind = ?)
        ORDER BY id LIMIT ?`,
      [lastId, MessageKind.Link, batchSize],
    );
    if (!rows.length) return result;
    for (const row of rows) {
      result.scanned += 1;
      const inserted = await storeSharedLinks(db, {
        messageId: Number(row.id), groupId: Number(row.group_id), kind: Number(row.kind) as MessageKind,
        senderUid: String(row.sender_uid), senderName: String(row.sender_name ?? ""), sentAt: row.sent_at as Date,
        text: row.text === null ? null : String(row.text), content: parseRawContent(row.raw_content),
      });
      if (inserted > 0) result.messagesWithLinks += 1;
      result.inserted += inserted;
    }
    lastId = Number(rows[rows.length - 1].id);
    options.onProgress?.(lastId, result);
    if (rows.length < batchSize) return result;
  }
}

/** mysql2 trả cột JSON đã đọc sẵn thành object; vài bản / cấu hình trả chuỗi — nhận cả hai. */
function parseRawContent(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
