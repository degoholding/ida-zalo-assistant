import { lookup } from "node:dns/promises";
import net from "node:net";
import { AiKeyProvider } from "../constants.js";
import { isPrivateAddress } from "./link-reader.js";
import { maskApiKeys } from "./openai-client.js";

// Danh mục hãng của màn «Khóa AI» (07/10/2026) + kiểm khóa trước khi lưu. Gemini đi GeminiClient; mọi hãng còn lại nói
// API kiểu OpenAI nên đi OpenAIClient với địa chỉ trạm dưới đây. Claude chưa có: kho chưa có client Anthropic.

export interface AiProviderInfo {
  label: string;
  /** Địa chỉ API chuẩn; rỗng = người dùng nhập (hãng tùy chỉnh). */
  baseUrl: string;
  /** Mô hình khi dòng khóa để trống ô mô hình. Rỗng = bắt buộc chọn (hoặc lấy mô hình đầu tiên trạm liệt kê). */
  defaultModel: string;
}

export const AI_PROVIDERS: Record<AiKeyProvider, AiProviderInfo> = {
  [AiKeyProvider.Gemini]: { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-3.5-flash-lite" },
  [AiKeyProvider.OpenAI]: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-6-luna" },
  [AiKeyProvider.OpenAICompatible]: { label: "Tương thích OpenAI (tùy chỉnh)", baseUrl: "", defaultModel: "" },
  [AiKeyProvider.DeepSeek]: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  [AiKeyProvider.Xai]: { label: "Grok (xAI)", baseUrl: "https://api.x.ai/v1", defaultModel: "grok-4-fast" },
  [AiKeyProvider.OpenRouter]: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openrouter/auto" },
};

export function isAiKeyProvider(value: unknown): value is AiKeyProvider {
  return typeof value === "number" && Object.prototype.hasOwnProperty.call(AI_PROVIDERS, value);
}

/** Lỗi kiểm khóa / địa chỉ trạm — câu tiếng Việt đưa thẳng lên màn hình (đã che khóa). */
export class AiKeyCheckError extends Error {}

const BAD_STATION = "Địa chỉ trạm phải dạng https://ten-mien/v1 (tên miền công khai).";

/**
 * Chỉ nhận `https://<tên miền công khai>[/đường dẫn]`: máy chủ gửi KHÓA tới địa chỉ này, để mở http / localhost / IP nội
 * bộ là vừa lộ khóa vừa thành lỗ dò mạng nội bộ (SSRF) — máy bot nằm cùng mạng với MySQL. Hàm thuần (chưa tra DNS).
 */
export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AiKeyCheckError(BAD_STATION);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || !host || url.username || url.password || url.search || url.hash) throw new AiKeyCheckError(BAD_STATION);
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new AiKeyCheckError("Địa chỉ trạm trỏ vào mạng nội bộ — không dùng được.");
  } else if (host === "localhost" || /\.(localhost|local|internal|lan|home)$/.test(host) || !host.includes(".")) {
    throw new AiKeyCheckError("Địa chỉ trạm trỏ vào mạng nội bộ — không dùng được.");
  }
  const normalized = `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  if (normalized.length > 300) throw new AiKeyCheckError("Địa chỉ trạm quá dài.");
  return normalized;
}

type Resolver = (host: string) => Promise<string[]>;
const resolveHost: Resolver = async (host) => (await lookup(host, { all: true })).map((item) => item.address);

/** Tên miền công khai nhưng trỏ về IP nội bộ (vd tự khai DNS 10.0.0.5) cũng chặn. */
export async function assertPublicStation(baseUrl: string, resolve: Resolver = resolveHost): Promise<void> {
  const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return;
  const addresses = await resolve(host).catch(() => []);
  if (!addresses.length) throw new AiKeyCheckError(`Không tìm thấy máy chủ ${host} — kiểm lại địa chỉ trạm.`);
  if (addresses.some(isPrivateAddress)) throw new AiKeyCheckError("Địa chỉ trạm trỏ vào mạng nội bộ — không dùng được.");
}

const PROBE_TIMEOUT_MS = 15_000;

export interface ProbeInput {
  provider: AiKeyProvider;
  key: string;
  /** Địa chỉ trạm đã chuẩn hóa (bắt buộc với hãng tùy chỉnh). */
  baseUrl: string;
  model: string;
}

export interface ProbeResult {
  /** Mô hình trạm / hãng liệt kê (có thể rỗng). */
  models: string[];
  /** Ghi chú kèm câu «Đã lưu» (vd hãng đang báo hết hạn mức nhưng khóa đúng). */
  note: string;
}

/**
 * Gọi thử hãng một lượt nhẹ (liệt kê mô hình — không tốn token) rồi mới lưu. Sai khóa / sai trạm thì ném AiKeyCheckError
 * với câu dễ hiểu. Trạm tùy chỉnh không có /models mà đã chọn mô hình thì thử một lượt chat 1 token.
 */
export async function probeAiKey(input: ProbeInput, fetcher: typeof fetch = fetch): Promise<ProbeResult> {
  const info = AI_PROVIDERS[input.provider];
  const custom = input.provider === AiKeyProvider.OpenAICompatible;
  const who = custom ? `Trạm ${new URL(input.baseUrl).hostname}` : info.label;
  const base = custom ? input.baseUrl : info.baseUrl;
  const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
    try {
      return await fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new AiKeyCheckError(timedOut
        ? `${who} không trả lời sau ${PROBE_TIMEOUT_MS / 1000} giây — kiểm lại địa chỉ hoặc thử lại sau.`
        : `Không gọi được ${who} — kiểm lại địa chỉ trạm hoặc mạng của máy chủ.`);
    }
  };
  const bearer = { authorization: `Bearer ${input.key}` };

  let response: Response;
  if (input.provider === AiKeyProvider.Gemini) {
    response = await request(`${base}/models?pageSize=50`, { headers: { "x-goog-api-key": input.key } });
  } else if (input.provider === AiKeyProvider.OpenRouter) {
    // /models của OpenRouter mở công khai (không kiểm khóa) — /key mới trả 401 khi khóa sai
    response = await request(`${base}/key`, { headers: bearer });
  } else {
    response = await request(`${base}/models`, { headers: bearer });
    if (custom && (response.status === 404 || response.status === 405) && input.model) {
      response = await request(`${base}/chat/completions`, {
        method: "POST",
        headers: { ...bearer, "content-type": "application/json" },
        body: JSON.stringify({ model: input.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      });
    }
  }

  const text = await response.text().catch(() => "");
  const status = response.status;
  if (status >= 300 && status < 400) throw new AiKeyCheckError(`${who} chuyển hướng sang chỗ khác — dán đúng địa chỉ API (thường kết thúc bằng /v1).`);
  if (status === 402 || (status >= 400 && /insufficient_quota|billing|credit|balance/i.test(text))) {
    throw new AiKeyCheckError(`Khóa ${who} đã hết tiền — nạp thêm rồi lưu lại.`);
  }
  // Gemini báo khóa sai bằng 400 «API key not valid»
  if (status === 401 || status === 403 || (status === 400 && /api key|api_key/i.test(text))) {
    throw new AiKeyCheckError(`${who} không nhận khóa này (sai, đã thu hồi, hoặc chưa bật API).`);
  }
  if (status === 404) {
    throw new AiKeyCheckError(custom
      ? "Không thấy API ở địa chỉ trạm này — kiểm lại địa chỉ (thường kết thúc bằng /v1), hoặc chọn mô hình ở «Tùy chọn» để thử bằng một lượt chat."
      : `${who} trả 404 khi kiểm khóa.`);
  }
  if (status === 429) return { models: [], note: `${who} đang báo hết hạn mức (429) — khóa đúng, bot dùng được khi hãng mở lại.` };
  if (status >= 500) throw new AiKeyCheckError(`${who} đang lỗi (${status}) — thử lại sau ít phút.`);
  if (status !== 200) throw new AiKeyCheckError(maskApiKeys(`${who} trả lỗi ${status} khi kiểm khóa.`));

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AiKeyCheckError(`${who} không trả về API kiểu ${custom ? "OpenAI" : info.label} (nhận được trang web) — kiểm lại địa chỉ trạm.`);
  }
  const models = listModelNames(body);
  const note = input.model && models.length && !models.includes(input.model) && !models.includes(`models/${input.model}`)
    ? `Lưu ý: ${who} không liệt kê mô hình «${input.model}» — kiểm lại tên nếu bot báo lỗi.`
    : "";
  return { models, note };
}

/** Tên mô hình trong phản hồi /models (OpenAI: data[].id; Gemini: models[].name «models/…»). */
function listModelNames(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const record = body as { data?: unknown; models?: unknown };
  const items = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  return items.flatMap((item) => {
    const name = item && typeof item === "object" ? (item as { id?: unknown; name?: unknown }).id ?? (item as { name?: unknown }).name : null;
    return typeof name === "string" && name ? [name] : [];
  });
}
