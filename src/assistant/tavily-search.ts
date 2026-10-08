import { WebSearchUnavailableError, type WebSearchResult } from "./gemini-client.js";

// Tìm web bằng Tavily (08/10/2026, đại ca chọn «thêm dịch vụ tìm riêng»): bot không còn phụ thuộc tìm Google của Gemini
// (khóa Gemini hết tiền nạp trước thì tìm web chết theo; DeepSeek không có tìm web sẵn). Tavily trả kết quả + đoạn nội dung
// trang; mô hình đang trả lời (DeepSeek…) đọc rồi tóm tắt, ghi nguồn. Câu tìm KHÔNG được chứa dữ liệu nội bộ (luật chung).

const ENDPOINT = "https://api.tavily.com/search";
const TIMEOUT_MS = 30_000;
const MAX_RESULTS = 5;
const SNIPPET_CHARS = 900;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface TavilyResponse {
  answer?: string | null;
  results?: { title?: string; url?: string; content?: string; published_date?: string }[];
  detail?: { error?: string } | string;
}

/** Ghép câu tóm tắt + đoạn nội dung từng nguồn thành chữ cho mô hình đọc. Hàm thuần. */
export function formatTavilyResult(body: TavilyResponse): WebSearchResult {
  const results = (body.results ?? []).filter((item) => item.url || item.title).slice(0, MAX_RESULTS);
  const lines: string[] = [];
  if (body.answer) lines.push(`Tóm tắt nhanh: ${body.answer.trim()}`);
  results.forEach((item, index) => {
    const date = item.published_date ? ` (${item.published_date.slice(0, 10)})` : "";
    lines.push(`[${index + 1}] ${item.title ?? ""}${date} — ${item.url ?? ""}`);
    const snippet = (item.content ?? "").replace(/\s+/g, " ").trim();
    if (snippet) lines.push(snippet.length > SNIPPET_CHARS ? `${snippet.slice(0, SNIPPET_CHARS)}…` : snippet);
  });
  return {
    text: lines.join("\n"),
    sources: results.map((item) => ({ title: item.title ?? "", url: item.url ?? "" })),
    inputTokens: 0,
    outputTokens: 0,
  };
}

/** Hàm tìm web dùng khóa Tavily. Hết hạn mức / khóa sai → WebSearchUnavailableError (để lùi về nguồn khác nếu có). */
export function createTavilySearch(apiKey: string, fetchImpl: FetchLike = fetch): (query: string) => Promise<WebSearchResult> {
  return async (query: string) => {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ query, search_depth: "basic", include_answer: "basic", max_results: MAX_RESULTS, topic: "general" }),
    });
    const body = (await response.json().catch(() => ({}))) as TavilyResponse;
    // 401 khóa sai · 429 gọi quá nhanh · 432 / 433 hết hạn mức gói
    if ([401, 403, 429, 432, 433].includes(response.status)) {
      throw new WebSearchUnavailableError(`Tavily ${response.status}: ${typeof body.detail === "string" ? body.detail : body.detail?.error ?? ""}`.slice(0, 200));
    }
    if (!response.ok) throw new Error(`Tavily ${response.status}`);
    return formatTavilyResult(body);
  };
}
