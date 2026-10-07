import { lookup } from "node:dns/promises";
import net from "node:net";
import { extractDocx, extractSheet, type DocumentReader } from "./file-reader.js";

// Đọc NỘI DUNG một link người dùng gửi (07/10/2026 — trước đó bot không có cách đọc link, «đọc cái link» thì lấy đại
// tệp gần nhất). Link Google Sheets / Docs / Slides / Drive đổi sang đường XUẤT TỆP công khai (cần chia sẻ «Bất kỳ ai
// có đường liên kết»); trang web khác lấy chữ trong HTML. Chặn SSRF: chỉ http(s), mọi bước chuyển hướng đều kiểm máy
// đích không phải địa chỉ nội bộ (localhost, 10.x, 192.168.x, 169.254.x, …) — máy chủ bot nằm cùng mạng với MySQL.

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;
const MAX_CHARS = 200_000;

export type LinkKind = "sheet" | "doc" | "slides" | "drive" | "page";

export interface LinkTarget {
  kind: LinkKind;
  /** URL thật sự tải về (đường xuất tệp với link Google). */
  fetchUrl: string;
}

export class LinkReadError extends Error {}

const NOT_SHARED_TEXT =
  "Link Google này chưa mở công khai — nhờ người gửi bấm Chia sẻ → «Bất kỳ ai có đường liên kết» (Người xem) rồi bảo bot đọc lại.";

/** Link Google → đường xuất tệp; link khác giữ nguyên. Hàm thuần. */
export function resolveLinkTarget(raw: string): LinkTarget {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new LinkReadError("Link không hợp lệ.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LinkReadError("Chỉ đọc được link http / https.");
  const id = /\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname)?.[1];
  if (url.hostname === "docs.google.com" && id) {
    if (url.pathname.startsWith("/spreadsheets/")) return { kind: "sheet", fetchUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx` };
    if (url.pathname.startsWith("/document/")) return { kind: "doc", fetchUrl: `https://docs.google.com/document/d/${id}/export?format=txt` };
    if (url.pathname.startsWith("/presentation/")) return { kind: "slides", fetchUrl: `https://docs.google.com/presentation/d/${id}/export/txt` };
  }
  if (url.hostname === "drive.google.com" && id) return { kind: "drive", fetchUrl: `https://drive.google.com/uc?export=download&id=${id}` };
  return { kind: "page", fetchUrl: url.toString() };
}

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

/** Tải có giới hạn: tự đi theo chuyển hướng (kiểm từng bước), cắt ở MAX_BYTES. */
async function fetchPublic(startUrl: string, fetcher: typeof fetch): Promise<{ finalUrl: URL; contentType: string; data: Buffer }> {
  let url = new URL(startUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new LinkReadError("Link chuyển hướng sang giao thức lạ.");
    await assertPublicHost(url);
    let response: Response;
    try {
      response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "Mozilla/5.0 (BotTroLy)" } });
    } catch {
      throw new LinkReadError("Không tải được link (mạng lỗi hoặc quá 30 giây).");
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
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new LinkReadError("Nội dung link quá lớn (trên 20 MB).");
      chunks.push(Buffer.from(chunk));
    }
    return { finalUrl: url, contentType: (response.headers.get("content-type") ?? "").toLowerCase(), data: Buffer.concat(chunks) };
  }
  throw new LinkReadError("Link chuyển hướng quá nhiều lần.");
}

/** Chữ trong HTML: bỏ script / style / thẻ, giải vài thực thể hay gặp, gom khoảng trắng. */
export function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const body = html
    .replace(/<(script|style|noscript|svg|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return title ? `# ${title}\n${body}` : body;
}

export interface LinkContent {
  kind: LinkKind;
  how: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** Đọc link → chữ. `readDocument` (Gemini) để đọc PDF; không có thì PDF báo không đọc được. */
export async function readLinkContent(raw: string, readDocument?: DocumentReader, fetcher: typeof fetch = fetch): Promise<LinkContent> {
  const target = resolveLinkTarget(raw);
  const { finalUrl, contentType, data } = await fetchPublic(target.fetchUrl, fetcher);
  const zero = { inputTokens: 0, outputTokens: 0 };
  // Tệp Google chưa chia sẻ: Google chuyển sang trang đăng nhập (HTML) thay vì trả tệp
  if (target.kind !== "page" && (finalUrl.hostname === "accounts.google.com" || contentType.includes("text/html"))) {
    throw new LinkReadError(NOT_SHARED_TEXT);
  }
  const done = (how: string, text: string, tokens = zero) => ({ kind: target.kind, how, text: text.slice(0, MAX_CHARS), ...tokens });
  if (contentType.includes("spreadsheetml") || contentType.includes("ms-excel") || target.kind === "sheet") {
    return done("bảng tính", extractSheet(data).text);
  }
  if (contentType.includes("wordprocessingml")) return done("docx", extractDocx(data));
  if (contentType.includes("application/pdf")) {
    if (!readDocument) throw new LinkReadError("Bot chưa bật đọc PDF.");
    const result = await readDocument("application/pdf", data, "Chép lại toàn bộ chữ trong tài liệu, giữ bảng thành dòng các ô cách nhau ' | '.");
    return done("pdf (mô hình đọc)", result.text, { inputTokens: result.inputTokens, outputTokens: result.outputTokens });
  }
  if (contentType.includes("text/html")) return done("trang web", htmlToText(data.toString("utf8")));
  if (contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("csv") || target.kind === "doc" || target.kind === "slides") {
    return done("văn bản", data.toString("utf8").trim());
  }
  throw new LinkReadError(`Chưa đọc được loại nội dung «${contentType || "không rõ"}» của link này.`);
}
