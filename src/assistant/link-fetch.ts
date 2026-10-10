import { lookup } from "node:dns/promises";
import net from "node:net";

// Tải tệp qua link công khai, giới hạn an toàn: chặn SSRF (mọi bước chuyển hướng đều kiểm máy đích không phải địa chỉ
// nội bộ — máy chủ bot nằm cùng mạng với MySQL), cắt theo trần byte NƠI GỌI quyết định (`pickLimit`) ngay sau khi có
// header (chưa tải thân) — ghi âm được trần riêng, lớn hơn trang / tài liệu thường. Tách khỏi link-reader.ts
// (10/10/2026, thêm đọc ghi âm từ Drive) để mỗi tệp dưới 200 dòng.

const MAX_REDIRECTS = 5;
const CONNECT_TIMEOUT_MS = 30_000;
/** Ghi âm cuộc họp gỡ băng lâu — phần thân được tải tới ngần này trước khi bỏ cuộc (bước kết nối / chuyển hướng vẫn giữ CONNECT_TIMEOUT_MS). */
const AUDIO_BODY_TIMEOUT_MS = 5 * 60_000;
/** Chuỗi cố định trong trang Google Drive báo «tệp quá lớn, chưa quét được virus» — gặp khi tải không kèm `confirm=t`. */
const VIRUS_SCAN_MARKER = "Virus scan warning";

export class LinkReadError extends Error {}

export const NOT_SHARED_TEXT =
  "Link Google này chưa mở công khai — nhờ người gửi bấm Chia sẻ → «Bất kỳ ai có đường liên kết» (Người xem) rồi bảo bot đọc lại.";

const VIRUS_SCAN_TEXT =
  "Google Drive báo tệp này quá lớn để tự quét virus và cần xác nhận tải — bot đã thử tải thẳng nhưng Google vẫn chặn lại; " +
  "nhờ người gửi tải tệp về máy rồi gửi trực tiếp cho bot thay vì gửi link.";

/** Địa chỉ nội bộ / dành riêng — không cho bot gọi tới. */
export function isPrivateAddress(address: string): boolean {
  // IPv4 gói trong IPv6: «::ffff:127.0.0.1» — trình phân tích URL viết lại thành dạng hex «::ffff:7f00:1» (lỗ cũ: dạng hex
  // lọt qua vì không phải IPv4, tìm ra 07/10/2026 khi viết bài kiểm trạm Khóa AI)
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  const v4 = mappedHex
    ? [parseInt(mappedHex[1], 16) >> 8, parseInt(mappedHex[1], 16) & 255, parseInt(mappedHex[2], 16) >> 8, parseInt(mappedHex[2], 16) & 255].join(".")
    : address.startsWith("::ffff:") ? address.slice(7) : address;
  if (net.isIPv4(v4)) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = address.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((item) => item.address);
  if (!addresses.length) throw new LinkReadError(`Không tìm thấy máy chủ ${host}.`);
  if (addresses.some(isPrivateAddress)) throw new LinkReadError("Không đọc link trỏ vào mạng nội bộ.");
}

/** Tên tệp trong header Content-Disposition — Drive hay trả content-type chung chung, phải đoán loại theo đuôi tên tệp. */
function parseFileName(contentDisposition: string | null): string {
  if (!contentDisposition) return "";
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      /* tên tệp mã hóa lỗi — bỏ qua, dùng nhánh filename= thường bên dưới nếu có */
    }
  }
  return /filename="?([^";]+)"?/i.exec(contentDisposition)?.[1] ?? "";
}

export interface SizeLimit {
  maxBytes: number;
  /** Ghi âm được trần riêng + thông báo riêng khi vượt (khác trang / tài liệu thường). */
  isAudio: boolean;
  /** H3 (review 10/10/2026): nơi gọi có nghe ghi âm CHẢY THẲNG được không (readAudioSource, như worker recap họp) —
   * true thì `fetchPublic` trả luồng CHƯA đọc thay vì đệm cả tệp vào Buffer (đỡ ~3 lần RAM khi gửi tiếp cho Gemini). */
  stream?: boolean;
}

function sizeCapMessage(bytes: number, limit: SizeLimit): string {
  const mb = Math.round(bytes / 1024 / 1024);
  const capMb = Math.round(limit.maxBytes / 1024 / 1024);
  return limit.isAudio
    ? `Ghi âm ${mb} MB, quá mức ${capMb} MB bot được đọc (Cài đặt → Trợ lý → Cỡ tệp tối đa bot đọc).`
    : `Nội dung link quá lớn (${mb} MB, trên ${capMb} MB).`;
}

export interface FetchResult {
  finalUrl: URL;
  contentType: string;
  /** Tên tệp theo Content-Disposition, rỗng nếu máy chủ không gửi. */
  fileName: string;
  data: Buffer;
}

/** H3: kết quả CHẢY THẲNG — `body` chưa đọc, nơi gọi (readAudioSource) tự đọc tiếp, không qua Buffer trung gian. */
export interface FetchStreamResult {
  finalUrl: URL;
  contentType: string;
  fileName: string;
  /** Cỡ khai báo qua Content-Length lúc nhận header (Gemini cần số này để mở phiên tải resumable). */
  size: number;
  body: ReadableStream<Uint8Array>;
}

export type FetchOutcome = FetchResult | FetchStreamResult;

/** `"body" in result` không đủ phân biệt một cách type-safe gọn — hàm riêng cho rõ ý ở nơi gọi (link-reader.ts). */
export function isStreamResult(result: FetchOutcome): result is FetchStreamResult {
  return "body" in result;
}

/** Luồng audio CHẢY THẲNG: đếm byte đi qua, lỗi giữa chừng nếu vượt trần (phòng Content-Length thiếu / khai sai) —
 * không đệm thêm bản sao nào, chỉ chuyển tiếp đúng các Uint8Array đã nhận (H3). */
function cappedStream(body: ReadableStream<Uint8Array>, limit: SizeLimit): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > limit.maxBytes) {
        controller.error(new LinkReadError(sizeCapMessage(total, limit)));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
}

/**
 * Tải có giới hạn: tự đi theo chuyển hướng (kiểm từng bước không phải mạng nội bộ), trần byte do `pickLimit`
 * (biết content-type + tên tệp) quyết định ngay sau header — `Content-Length` vượt trần thì báo ngay, không tải thân.
 * H3: khi `pickLimit` trả `isAudio && stream` (và content-type không phải trang HTML lỗi) → trả CHẢY THẲNG
 * (`FetchStreamResult`), không đệm Buffer — nơi gọi không có khả năng nghe luồng (`stream` falsy, vd chỉ còn OpenAI)
 * vẫn đệm như cũ để tương thích ngược.
 */
export async function fetchPublic(startUrl: string, fetcher: typeof fetch, pickLimit: (contentType: string, fileName: string) => SizeLimit): Promise<FetchOutcome> {
  let url = new URL(startUrl);
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new LinkReadError("Link chuyển hướng sang giao thức lạ.");
      await assertPublicHost(url);
      let response: Response;
      try {
        response = await fetcher(url, { redirect: "manual", signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (BotTroLy)" } });
      } catch {
        throw new LinkReadError("Không tải được link (mạng lỗi hoặc quá thời gian chờ).");
      }
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url);
        continue;
      }
      if (response.status === 401 || response.status === 403) throw new LinkReadError(url.hostname.endsWith("google.com") ? NOT_SHARED_TEXT : `Trang từ chối truy cập (${response.status}).`);
      if (response.status === 404 && url.hostname.endsWith("google.com")) {
        throw new LinkReadError("Không thấy tệp Google này — link sai, tệp đã bị xóa, hoặc chưa chia sẻ «Bất kỳ ai có đường liên kết».");
      }
      if (!response.ok) throw new LinkReadError(`Trang trả lỗi ${response.status}.`);
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      const fileName = parseFileName(response.headers.get("content-disposition"));
      const limit = pickLimit(contentType, fileName);
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > limit.maxBytes) throw new LinkReadError(sizeCapMessage(declaredLength, limit));
      // Đã biết loại (header xong) — ghi âm gỡ băng dài thì nới thời gian đọc phần thân
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), limit.isAudio ? AUDIO_BODY_TIMEOUT_MS : CONNECT_TIMEOUT_MS);
      // H3: nơi gọi nghe ghi âm CHẢY THẲNG được (`stream`) và đây đúng là ghi âm (không phải trang HTML lỗi Drive trả
      // về) → trả luồng thẳng, KHÔNG đệm Buffer (đỡ bản sao trong RAM app khi gửi tiếp cho Gemini, xem readAudioSource).
      // `declaredLength` thiếu/0 (hiếm với tải trực tiếp) thì vẫn đệm như cũ — Gemini cần size đúng để mở phiên tải.
      if (limit.isAudio && limit.stream && declaredLength > 0 && !contentType.includes("text/html") && response.body) {
        return { finalUrl: url, contentType, fileName, size: declaredLength, body: cappedStream(response.body, limit) };
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body ?? []) {
        size += chunk.length;
        if (size > limit.maxBytes) throw new LinkReadError(sizeCapMessage(size, limit));
        chunks.push(Buffer.from(chunk));
      }
      const data = Buffer.concat(chunks);
      // Tệp Drive lớn chưa kèm confirm=t: Google trả trang HTML cảnh báo thay vì tệp — báo rõ, không nhầm «chưa chia sẻ»
      if (contentType.includes("text/html") && data.includes(VIRUS_SCAN_MARKER)) throw new LinkReadError(VIRUS_SCAN_TEXT);
      return { finalUrl: url, contentType, fileName, data };
    }
    throw new LinkReadError("Link chuyển hướng quá nhiều lần.");
  } finally {
    clearTimeout(timer);
  }
}
