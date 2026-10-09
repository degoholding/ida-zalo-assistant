import type { RowDataPacket } from "mysql2";
import { ConversationType } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger } from "../logger.js";
import { loadIndexedFrom } from "./message-search-index.js";

// Tìm tin nhắn (phase 6 — N4, IDA câu 21). Dùng chung cho màn «Tìm tin» trên web và công cụ search_messages của trợ lý.
//
// Mọi câu tìm chạy trên bảng tìm message_search (migration 023, giữ khớp bởi message-search-index.ts) — tin cũ còn đang
// chép thì kết quả báo «mới tìm được từ khoảng ngày …» (indexedFrom). Hai lối, chọn tự động:
// 1. TOÀN VĂN (bộ tách theo khoảng trắng): mỗi từ khóa phải có mặt, cụm trong ngoặc kép giữ thứ tự; gõ không dấu khớp có
//    dấu, kể cả «đ» = «d» (collation utf8mb4_0900_ai_ci). Nhanh khi từ khóa cụ thể (tên khách, mã hàng, số tiền).
// 2. QUÉT LIKE TRONG CỬA SỔ NGÀY (90 ngày tính lùi từ mốc «đến» người tìm chọn, không chọn thì từ bây giờ; đi theo chỉ mục
//    giờ gửi) khi: từ khóa ngắn hơn MySQL đánh chỉ mục; MySQL chưa đặt trần bộ nhớ cho câu tìm (để mặc định 2 GB thì một câu
//    tìm từ phổ biến có thể làm sập MySQL — đo 09/10/2026); hoặc câu tìm toàn văn VƯỢT trần (từ quá phổ biến). Kết quả báo
//    rõ «chỉ tìm từ ngày …» (windowFrom).

const log = createLogger("search");

export interface SqlCondition {
  sql: string;
  params: unknown[];
}

/** Ký tự điều khiển của BOOLEAN MODE — bỏ khỏi chữ người gõ để không thành toán tử (vd «-» làm loại trừ, «*» làm gần đúng). */
const BOOLEAN_OPERATORS = /[+\-<>()~*"@]/g;
const MAX_TERMS = 8;
const MAX_TERM_CHARS = 60;
/** Lối quét LIKE chỉ xét ngần này ngày gần nhất khi người tìm không tự chọn khoảng ngày. */
export const LIKE_WINDOW_DAYS = 90;
/**
 * Trần bộ nhớ một câu tìm toàn văn tối đa còn coi là «đã cấu hình» (docker-compose đặt 32 MB; mặc định MySQL 2 GB = chưa
 * cấu hình → chỉ dùng LIKE).
 */
const SAFE_FT_RESULT_CACHE_BYTES = 128 * 1024 * 1024;
/** Mỗi câu tìm tối đa ngần này mili giây (gợi ý MAX_EXECUTION_TIME) — quá thì báo «thu hẹp lại», không giữ kết nối mãi. */
export const SEARCH_TIMEOUT_MS = 5000;
/** Gợi ý đặt ngay sau SELECT của câu tìm. */
export const SEARCH_TIME_HINT = `/*+ MAX_EXECUTION_TIME(${SEARCH_TIMEOUT_MS}) */`;
const CAPABILITY_TTL_MS = 10 * 60 * 1000;
const DAY_MS = 86_400_000;
/**
 * Nguồn của mọi câu tìm: bảng tìm `s` (chữ có chỉ mục toàn văn + nhóm + giờ gửi, migration 023) nối tin gốc `m` (người gửi,
 * loại, thu hồi) và nhóm `g`. Lọc / sắp theo nhóm + giờ đặt trên `s` để đi chỉ mục của bảng tìm.
 */
export const SEARCH_FROM = "FROM message_search s JOIN message m ON m.id = s.message_id JOIN zalo_group g ON g.id = s.group_id";

/** Tách câu tìm thành các «từ khóa»: cụm trong ngoặc kép giữ nguyên, phần còn lại tách theo khoảng trắng. Hàm thuần. */
export function splitSearchTerms(input: string): string[] {
  const terms: string[] = [];
  const text = input.normalize("NFC");
  const quoted = /"([^"]+)"/g;
  for (const match of text.matchAll(quoted)) terms.push(match[1]);
  for (const word of text.replace(quoted, " ").split(/\s+/)) terms.push(word);
  const cleaned = terms
    .map((term) => term.replace(BOOLEAN_OPERATORS, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TERM_CHARS))
    // Toàn dấu câu / emoji («?», «...», «😀») không có trong chỉ mục — giữ lại thì cả câu tìm ra 0 kết quả
    .filter((term) => /[\p{L}\p{N}]/u.test(term));
  return [...new Set(cleaned)].slice(0, MAX_TERMS);
}

/** MySQL đang chạy có dùng được tìm toàn văn an toàn không, và đánh chỉ mục từ dài từ mấy ký tự. */
export interface FulltextCapabilities {
  enabled: boolean;
  minTokenSize: number;
}

const escapeLike = (term: string) => `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/** Chữ đơn như bộ tách mặc định của MySQL thấy: cắt ở mọi ký tự không phải chữ / số («10.000.000» → 10, 000). Hàm thuần. */
const splitIndexWords = (term: string): string[] => term.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);

/**
 * Điều kiện SQL cho câu tìm trên cột chữ `column`. null = câu tìm rỗng. `fulltext` = có dùng chỉ mục toàn văn không (không
 * dùng thì nơi gọi phải giới hạn khoảng ngày). Hàm thuần.
 *
 * MATCH chỉ nhận CHỮ ĐƠN bắt buộc (`+công +nợ`), KHÔNG nhận cụm (`+"công nợ"`): đo 09/10/2026 trên 300 nghìn tin, câu
 * cụm gồm chữ phổ biến phải so vị trí chữ trong từng tin — dùng bộ nhớ VƯỢT trần innodb_ft_result_cache_limit và làm MySQL
 * 768 MB bị giết; câu chữ đơn thì nằm trong trần (vượt thì báo lỗi 188, lối lùi LIKE). Thứ tự của cụm, chữ ngắn hơn
 * minTokenSize, chữ có dấu câu («10.000.000», «A&B») được kiểm lại bằng LIKE trên các dòng MATCH đã lọc.
 */
export function messageTextCondition(input: string, capabilities: FulltextCapabilities, column = "s.text"): (SqlCondition & { fulltext: boolean }) | null {
  const terms = splitSearchTerms(input);
  if (!terms.length) return null;
  const indexable = (word: string) => Array.from(word).length >= capabilities.minTokenSize;
  const ftWords = capabilities.enabled ? [...new Set(terms.flatMap(splitIndexWords).filter(indexable))] : [];
  // Từ khóa là đúng MỘT chữ đơn đã có trong MATCH thì thôi; còn lại (cụm, chữ ngắn, có dấu câu) kiểm bằng LIKE
  const likeTerms = terms.filter((term) => !(splitIndexWords(term).join(" ") === term && ftWords.includes(term)));
  const parts: string[] = [];
  const params: unknown[] = [];
  if (ftWords.length) {
    parts.push(`MATCH(${column}) AGAINST(? IN BOOLEAN MODE)`);
    params.push(ftWords.map((word) => `+${word}`).join(" "));
  }
  for (const term of likeTerms) {
    parts.push(`${column} LIKE ?`);
    params.push(escapeLike(term));
  }
  return { sql: parts.join(" AND "), params, fulltext: ftWords.length > 0 };
}

/** Như messageTextCondition nhưng chỉ dùng LIKE — lối lùi khi câu tìm toàn văn vượt trần bộ nhớ. Hàm thuần. */
export function likeOnlyCondition(input: string, column = "s.text"): SqlCondition | null {
  const terms = splitSearchTerms(input);
  if (!terms.length) return null;
  return { sql: terms.map(() => `${column} LIKE ?`).join(" AND "), params: terms.map(escapeLike) };
}

/** Câu tìm chạy quá SEARCH_TIMEOUT_MS (ER_QUERY_TIMEOUT, mã 3024). */
export function isSearchTimeoutError(error: unknown): boolean {
  const { errno, code } = (error ?? {}) as { errno?: number; code?: string };
  return errno === 3024 || code === "ER_QUERY_TIMEOUT";
}

export const SEARCH_TIMEOUT_TEXT = "Tìm lâu quá — thêm từ khóa cụ thể hơn, hoặc chọn cuộc trò chuyện / khoảng ngày để thu hẹp.";

/** Câu tìm toàn văn vượt innodb_ft_result_cache_limit (ER_FTS_EXCEED_RESULT_CACHE_LIMIT, mã 188). */
export function isFulltextCacheLimitError(error: unknown): boolean {
  const { errno, code } = (error ?? {}) as { errno?: number; code?: string };
  return errno === 188 || code === "ER_FTS_EXCEED_RESULT_CACHE_LIMIT";
}

/**
 * Mốc bắt đầu cửa sổ quét LIKE: người tìm đã chọn «từ ngày» thì giữ; không thì N ngày tính lùi từ `until` — mốc «đến» người
 * tìm chọn, không chọn thì bây giờ. Tính lùi từ «đến» để lọc «≤ 31/12/2025» không thành cửa sổ rỗng (90 ngày gần nhất AND
 * trước 2026). Hàm thuần.
 */
export function likeWindowStart(from: Date | undefined, until: Date, days = LIKE_WINDOW_DAYS): Date {
  return from ?? new Date(until.getTime() - days * DAY_MS);
}

/**
 * Tối đa ngần này câu tìm chạy cùng lúc trong MySQL (cả tiến trình, chung màn web + trợ lý). Mỗi câu toàn văn được dùng
 * tới innodb_ft_result_cache_limit (32 MB): 100 nhóm cùng tìm một từ phổ biến mà không giới hạn thì vượt RAM MySQL (768 MB)
 * — đúng lỗi đã đo 09/10/2026. Đo trên 1 triệu tin: MySQL nghỉ ~670 MB; trần 64 MB × 2 câu cùng lúc đã làm MySQL bị giết,
 * trần 32 MB × 2 thì 6 câu dồn cùng lúc vẫn ~600 MB. Câu tìm < 1 giây nên chờ lượt gần như không thấy; câu đang chờ không
 * giữ kết nối DB.
 */
export const MAX_CONCURRENT_SEARCHES = 2;

/** Giới hạn số việc chạy cùng lúc; việc thứ max+1 chờ tới lượt (theo thứ tự đến). */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly max: number) {}

  /** Đang chạy / đang chờ — để đo và kiểm. */
  get stats(): { active: number; waiting: number } {
    return { active: this.active, waiting: this.waiting.length };
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active < this.max) this.active += 1;
    // Hết chỗ: chờ việc đang chạy trao thẳng chỗ của nó (active giữ nguyên)
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

export const searchLimiter = new ConcurrencyLimiter(MAX_CONCURRENT_SEARCHES);

let cachedCapabilities: { value: FulltextCapabilities; until: number } | null = null;

/**
 * Đọc cấu hình MySQL (nhớ 10 phút). Trần bộ nhớ câu tìm còn để mặc định (2 GB) → không dùng toàn văn: VPS chưa đổi cấu hình
 * MySQL theo docker-compose.yml mà vẫn chạy được, chỉ chậm hơn.
 */
export async function loadFulltextCapabilities(db: Db): Promise<FulltextCapabilities> {
  if (cachedCapabilities && cachedCapabilities.until > Date.now()) return cachedCapabilities.value;
  let value: FulltextCapabilities = { enabled: false, minTokenSize: 3 };
  try {
    // min token LÚC TẠO bảng tìm (search_index_meta, migration 023): đổi cấu hình MySQL sau đó thì tin đã chép trước đó vẫn
    // thiếu từ ngắn → lấy số lớn hơn, từ ngắn đi LIKE thay vì ra rỗng. Bảng tìm luôn có chỉ mục toàn văn (tạo cùng bảng).
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT @@innodb_ft_min_token_size AS min_token, @@innodb_ft_result_cache_limit AS cache_limit,
              (SELECT min_token_size FROM search_index_meta WHERE name = 'message_search') AS built_min_token`);
    const row = rows[0] ?? {};
    const safe = Number(row.cache_limit) <= SAFE_FT_RESULT_CACHE_BYTES;
    const minToken = Math.max(1, Number(row.min_token) || 3, Number(row.built_min_token) || 1);
    value = { enabled: safe, minTokenSize: minToken };
    if (!safe) log.warn("innodb_ft_result_cache_limit chưa đặt (mặc định 2 GB) — tìm tin dùng quét LIKE trong cửa sổ ngày; đặt theo docker-compose.yml");
  } catch (error) {
    log.warn("không đọc được cấu hình tìm toàn văn — dùng quét LIKE", error);
  }
  cachedCapabilities = { value, until: Date.now() + CAPABILITY_TTL_MS };
  return value;
}

/** Bỏ dấu + chữ thường TỪNG KÝ TỰ, giữ nguyên độ dài để vị trí tìm trên bản gấp dùng được cho chuỗi gốc. */
function foldKeepLength(text: string): string {
  return Array.from(text, (char) => {
    const folded = char.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
    return folded.length === 1 ? folded : folded.length === 0 ? " " : folded[0];
  }).join("");
}

/**
 * Đoạn trích quanh chỗ khớp đầu tiên (không phân biệt dấu / hoa thường), luôn chứa trọn từ khóa + `radius` ký tự mỗi bên,
 * «…» ở chỗ bị cắt. Không thấy chỗ khớp thì lấy đầu tin. Hàm thuần.
 */
export function buildSnippet(text: string, input: string, radius = 90): string {
  // NFC: tin gõ bằng «Unicode tổ hợp» (dấu tách rời) vẫn tìm đúng chỗ khớp
  const chars = Array.from(text.normalize("NFC").replace(/\s+/g, " ").trim());
  const haystack = foldKeepLength(chars.join(""));
  // Chỗ khớp sớm nhất + độ dài từ khóa đó — đoạn trích luôn chứa trọn từ khóa, thêm `radius` ký tự mỗi bên
  const hits = splitSearchTerms(input)
    .map((term) => {
      const needle = foldKeepLength(term.normalize("NFC"));
      return { at: haystack.indexOf(needle), length: Array.from(needle).length };
    })
    .filter((item) => item.at >= 0)
    .sort((a, b) => a.at - b.at);
  const hit = hits[0] ?? { at: 0, length: 0 };
  const start = Math.max(0, hit.at - radius);
  const end = Math.min(chars.length, hit.at + hit.length + radius);
  return `${start > 0 ? "…" : ""}${chars.slice(start, end).join("").trim()}${end < chars.length ? "…" : ""}`;
}

export interface MessageSearchOptions {
  query: string;
  /** Chỉ tìm trong các nhóm này (vd hỏi trong nhóm = đúng nhóm đó). Bỏ trống = mọi cuộc đang lưu. */
  groupIds?: number[];
  /** Bỏ nhóm Mật — trợ lý AI không bao giờ thấy nhóm Mật (phase 3). */
  excludeConfidential: boolean;
  /** Chỉ nhóm đang bật «Đọc tin» (không tìm tin riêng người khác nhắn bot) — đúng phạm vi các công cụ khác của trợ lý. */
  onlyReadGroups: boolean;
  /** Lọc người gửi theo tên (khớp một phần). */
  senderName?: string;
  from?: Date;
  to?: Date;
  limit: number;
  now?: Date;
}

export interface MessageSearchHit {
  messageId: number;
  threadId: number;
  threadName: string;
  senderName: string;
  sentAt: Date;
  snippet: string;
}

export interface MessageSearchResult {
  hits: MessageSearchHit[];
  /** Có giá trị = lối quét LIKE tự giới hạn, chỉ tìm các tin từ mốc này trở đi — báo cho người hỏi. */
  windowFrom: Date | null;
  /** Có giá trị = tin cũ đang được chép vào bảng tìm, mới tìm được từ khoảng mốc này trở đi — báo cho người hỏi. */
  indexedFrom: Date | null;
}

/** Tìm tin cho trợ lý: mới nhất trước, kèm đoạn trích. Câu tìm rỗng → không trả gì (không liệt kê bừa). */
export async function searchMessages(db: Db, options: MessageSearchOptions): Promise<MessageSearchResult> {
  const capabilities = await loadFulltextCapabilities(db);
  const match = messageTextCondition(options.query, capabilities);
  if (!match || (options.groupIds && !options.groupIds.length)) return { hits: [], windowFrom: null, indexedFrom: null };
  const now = options.now ?? new Date();
  const run = async (text: SqlCondition, from: Date | undefined) => {
    const where: string[] = [text.sql, "m.recalled_at IS NULL"];
    const params: unknown[] = [...text.params];
    if (options.groupIds) {
      where.push("s.group_id IN (?)");
      params.push(options.groupIds);
    }
    if (options.excludeConfidential) where.push("g.is_confidential = 0");
    if (options.onlyReadGroups) {
      where.push("g.thread_type = ? AND g.read_messages = 1");
      params.push(ConversationType.Group);
    }
    if (options.senderName?.trim()) {
      where.push("m.sender_name LIKE ?");
      params.push(escapeLike(options.senderName.trim()));
    }
    if (from) {
      where.push("s.sent_at >= ?");
      params.push(from);
    }
    if (options.to) {
      where.push("s.sent_at <= ?");
      params.push(options.to);
    }
    const [rows] = await searchLimiter.run(() => db.query<RowDataPacket[]>(
      `SELECT ${SEARCH_TIME_HINT} m.id, m.group_id, COALESCE(NULLIF(g.label, ''), g.name) AS thread_name, m.sender_name, m.sent_at, s.text
       ${SEARCH_FROM}
       WHERE ${where.join(" AND ")} ORDER BY s.sent_at DESC, s.message_id DESC LIMIT ?`,
      [...params, options.limit],
    ));
    return rows.map((row) => ({
      messageId: Number(row.id), threadId: Number(row.group_id), threadName: String(row.thread_name ?? ""),
      senderName: String(row.sender_name ?? ""), sentAt: row.sent_at as Date, snippet: buildSnippet(String(row.text ?? ""), options.query),
    }));
  };
  const likeFrom = likeWindowStart(options.from, options.to ?? now);
  // Người tìm tự chọn «từ ngày» thì không phải cửa sổ tự đặt — không cần báo
  const windowFrom = options.from ? null : likeFrom;
  const indexedFrom = relevantIndexedFrom(await loadIndexedFrom(db), options.from);
  if (!match.fulltext) return { hits: await run(match, likeFrom), windowFrom, indexedFrom };
  try {
    return { hits: await run(match, options.from), windowFrom: null, indexedFrom };
  } catch (error) {
    if (!isFulltextCacheLimitError(error)) throw error;
    // Từ khóa quá phổ biến — quét LIKE trong cửa sổ ngày thay vì làm MySQL quá tải
    return { hits: await run(likeOnlyCondition(options.query)!, likeFrom), windowFrom, indexedFrom };
  }
}

/**
 * Mốc «tin cũ chưa chép xong» có cần báo cho lần tìm này không: người tìm chỉ xét từ một ngày SAU mốc đó thì kết quả đã đủ,
 * không báo. Hàm thuần.
 */
export function relevantIndexedFrom(indexedFrom: Date | null, from: Date | undefined): Date | null {
  if (!indexedFrom) return null;
  return from && from >= indexedFrom ? null : indexedFrom;
}
