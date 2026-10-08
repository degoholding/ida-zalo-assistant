import dns from "node:dns/promises";
import net from "node:net";
import type { WebSearchResult } from "./gemini-client.js";

// Tìm web KHÔNG cần khóa (08/10/2026, đại ca: «bot ERP search được») — chép cách của bot ERP (ai-CR-110,
// procurement-tool backend/app/modules/agent_hub/web_search.py): tìm DuckDuckGo bản HTML → không ra thì Bing → tải song song
// vài trang đầu, bóc chữ → mô hình đang dùng (DeepSeek…) đọc khối kết quả đánh số [n] rồi tóm tắt, ghi nguồn.
// Kết quả tìm kiếm là dữ liệu người ngoài: chỉ tải trang CÔNG KHAI (chặn localhost / IP nội bộ, kể cả sau chuyển hướng),
// giới hạn dung lượng, chỉ nhận HTML / chữ.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SEARCH_TIMEOUT_MS = 15_000;
const PAGE_TIMEOUT_MS = 10_000;
const PAGE_MAX_BYTES = 1_500_000;
const PAGE_CHARS = 5000;
const MAX_RESULTS = 8;
const FETCH_PAGES = 4;
const MAX_REDIRECTS = 3;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export type HostResolver = (host: string) => Promise<string[]>;

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const clean = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Kết quả DuckDuckGo bản HTML. Hàm thuần — bỏ quảng cáo, mở link chuyển hướng `uddg=`. */
export function parseDuckDuckGo(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const pattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="result__a"|$)/g;
  for (const match of html.matchAll(pattern)) {
    let href = decodeEntities(match[1]);
    if (href.includes("uddg=")) {
      try {
        href = new URL(href.startsWith("http") ? href : `https:${href}`).searchParams.get("uddg") ?? "";
      } catch {
        continue;
      }
    }
    if (href.includes("duckduckgo.com/y.js") || !href.startsWith("http")) continue;
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(match[3]);
    hits.push({ title: clean(match[2]), url: href, snippet: snippet ? clean(snippet[1]) : "" });
  }
  return hits;
}

/** Kết quả Bing. Hàm thuần. */
export function parseBing(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const block of html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? []) {
    const link = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link || !link[1].startsWith("http")) continue;
    const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
    hits.push({ title: clean(link[2]), url: decodeEntities(link[1]), snippet: paragraph ? clean(paragraph[1]) : "" });
  }
  return hits;
}

/** Chữ đọc được của một trang HTML: bỏ script / style / menu / chân trang… Hàm thuần. */
export function extractPageText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|nav|footer|header|svg|form|aside|iframe)\b[\s\S]*?<\/\1>/gi, " ");
  return clean(stripped);
}

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
  return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8")
    || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") || lower.startsWith("ff");
}

const defaultResolver: HostResolver = async (host) => (await dns.lookup(host, { all: true })).map((entry) => entry.address);

/** Link có trỏ ra Internet công khai không (không phải localhost / mạng nội bộ / máy chủ của chính mình). */
export async function isPublicUrl(url: string, resolve: HostResolver = defaultResolver): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!["http:", "https:"].includes(parsed.protocol) || !host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (net.isIP(host)) return !isPrivateAddress(host);
  try {
    const addresses = await resolve(host);
    return addresses.length > 0 && addresses.every((address) => !isPrivateAddress(address));
  } catch {
    return false;
  }
}

export interface FreeWebSearchDeps {
  fetchImpl?: FetchLike;
  resolve?: HostResolver;
}

async function searchEngines(query: string, fetchImpl: FetchLike): Promise<SearchHit[]> {
  const engines: (() => Promise<SearchHit[]>)[] = [
    async () => {
      const response = await fetchImpl("https://html.duckduckgo.com/html/", {
        method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ q: query, kl: "vn-vi" }).toString(), signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
      return response.ok ? parseDuckDuckGo(await response.text()) : [];
    },
    async () => {
      const url = `https://www.bing.com/search?${new URLSearchParams({ q: query, setlang: "vi", cc: "VN" })}`;
      const response = await fetchImpl(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
      return response.ok ? parseBing(await response.text()) : [];
    },
  ];
  for (const engine of engines) {
    const hits = await engine().catch(() => [] as SearchHit[]);
    if (hits.length) {
      const seen = new Set<string>();
      return hits.filter((hit) => {
        const key = hit.url.split("#")[0].replace(/\/$/, "");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, MAX_RESULTS);
    }
  }
  return [];
}

/** Chữ của một trang công khai (≤ PAGE_CHARS). Hỏng / bị chặn / không phải HTML → rỗng. */
async function fetchPageText(url: string, fetchImpl: FetchLike, resolve: HostResolver): Promise<string> {
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!(await isPublicUrl(current, resolve))) return "";
      const response = await fetchImpl(current, {
        headers: { "User-Agent": UA, "Accept-Language": "vi,en;q=0.8" }, redirect: "manual", signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return "";
        current = new URL(location, current).toString();
        continue;
      }
      const type = response.headers.get("content-type") ?? "text/html";
      if (response.status !== 200 || !/html|text\/plain/.test(type) || !response.body) return "";
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (size <= PAGE_MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
      }
      await reader.cancel().catch(() => undefined);
      const html = Buffer.concat(chunks).toString("utf8");
      return (type.includes("html") ? extractPageText(html) : html.replace(/\s+/g, " ").trim()).slice(0, PAGE_CHARS);
    }
  } catch {
    return "";
  }
  return "";
}

/** Tìm + đọc vài trang đầu → khối kết quả đánh số [n] cho mô hình. Không ra kết quả nào thì ném lỗi. */
export function createFreeWebSearch(deps: FreeWebSearchDeps = {}): (query: string) => Promise<WebSearchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const resolve = deps.resolve ?? defaultResolver;
  return async (query: string) => {
    const hits = await searchEngines(query, fetchImpl);
    if (!hits.length) throw new Error("không tìm được kết quả nào trên mạng (máy tìm kiếm không trả lời)");
    const bodies = await Promise.all(hits.slice(0, FETCH_PAGES).map((hit) => fetchPageText(hit.url, fetchImpl, resolve)));
    const blocks = hits.map((hit, index) => [
      `[${index + 1}] ${hit.title} — ${hit.url}`,
      ...(hit.snippet ? [`Tóm tắt kết quả tìm: ${hit.snippet}`] : []),
      ...(bodies[index] ? [`Nội dung trang: ${bodies[index]}`] : []),
    ].join("\n"));
    return {
      text: blocks.join("\n\n"),
      sources: hits.map((hit) => ({ title: hit.title, url: hit.url })).slice(0, 5),
      inputTokens: 0,
      outputTokens: 0,
    };
  };
}
