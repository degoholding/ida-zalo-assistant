import { createLogger } from "../logger.js";
import {
  GeminiHttpError,
  WebSearchUnavailableError,
  type DocumentReadResult,
  type GeminiResult,
  type GenerateRequest,
  type ModelClient,
  type WebSearchResult,
} from "./gemini-client.js";
import { OpenAIHttpError, maskApiKeys } from "./openai-client.js";

// Chuỗi «Khóa AI» (07/10/2026): bot dùng khóa số 1; khóa đó hết tiền (402), hết hạn mức (429), sai / hết quyền (401/403),
// quá tải (5xx), quá thời gian hay lỗi bất kỳ thì làm lại lượt đó bằng khóa số 2, số 3… — im lặng với người hỏi, chỉ ghi
// log + đánh dấu lỗi gần nhất của khóa để màn Khóa AI hiện «lỗi lúc hh:mm: hết tiền». Khóa vừa lỗi xuống cuối hàng
// KEY_COOLDOWN_MS (khỏi mỗi câu hỏi chờ khóa hỏng trước); khóa chạm trần lượt / ngày (giờ Việt Nam) thì bỏ qua tới hôm sau.

const log = createLogger("ai");

/** Khóa vừa lỗi thì xếp xuống cuối hàng ngần này — như chế độ «ưu tiên OpenAI» cũ nghỉ OpenAI 10 phút. */
export const KEY_COOLDOWN_MS = 10 * 60 * 1000;
/**
 * Tên mô hình «việc nặng» mà AssistantService gửi xuống khi chạy bằng chuỗi khóa: mỗi khóa tự đổi thành mô hình việc nặng
 * của nó (hoặc chính mô hình chính khi khóa không khai bản nặng).
 */
export const HEAVY_MODEL_ALIAS = "@heavy";
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Ngày giờ Việt Nam «2026-10-07» — mốc đếm lượt / ngày của từng khóa. Hàm thuần. */
export function vnDayKey(ms: number): string {
  return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
}

export type KeyProblemKind = "out_of_credit" | "rate_limited" | "bad_key" | "model_missing" | "overloaded" | "timeout" | "unreachable" | "other";

export interface KeyProblem {
  kind: KeyProblemKind;
  /** Câu ngắn hiện trên màn Khóa AI, vd «hết tiền (402)». */
  label: string;
}

const KIND_LABEL: Record<KeyProblemKind, string> = {
  out_of_credit: "hết tiền",
  rate_limited: "hết hạn mức",
  bad_key: "khóa sai / hết quyền",
  model_missing: "không có mô hình",
  overloaded: "hãng quá tải",
  timeout: "quá thời gian",
  unreachable: "không gọi được hãng",
  other: "lỗi khác",
};

function statusOf(error: unknown): number {
  if (error instanceof OpenAIHttpError || error instanceof GeminiHttpError) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : 0;
}

/** Lỗi của một lượt gọi → loại lỗi của KHÓA (để ghi «lỗi lúc hh:mm: …»). Hàm thuần. */
export function classifyKeyError(error: unknown): KeyProblem {
  const status = statusOf(error);
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const make = (kind: KeyProblemKind): KeyProblem => ({ kind, label: status ? `${KIND_LABEL[kind]} (${status})` : KIND_LABEL[kind] });
  // OpenAI báo hết tiền bằng 429 «insufficient_quota» — xét chữ trước mã 429
  if (status === 402 || /insufficient_quota|insufficient balance|billing|credit balance|payment required/i.test(message)) return make("out_of_credit");
  if (status === 429) return make("rate_limited");
  if (status === 401 || status === 403 || /api key not valid|api_key_invalid|invalid_api_key|incorrect api key/i.test(message)) return make("bad_key");
  if (status === 404) return make("model_missing");
  if (status >= 500) return make("overloaded");
  if (/timeout|timed out/i.test(message)) return make("timeout");
  if (!status && /fetch failed|lỗi mạng|ECONNREFUSED|ENOTFOUND|ECONNRESET|connection error/i.test(message)) return make("unreachable");
  return make("other");
}

/** Che khóa trong câu lỗi trước khi ghi log (khóa OpenAI «sk-…», khóa Google «AIza…»). */
function maskSecrets(text: string): string {
  return maskApiKeys(text).replace(/AIza[0-9A-Za-z_-]{10,}/g, "AIza***");
}

/** Một khóa trong chuỗi — đã có client gọi hãng. */
export interface ChainKey {
  id: number;
  /** Nhãn cho log, vd «OpenAI …ab12» — không bao giờ chứa khóa đầy đủ. */
  label: string;
  client: ModelClient & { lastModel?: string };
  model: string;
  /** Rỗng = việc nặng dùng chính `model`. */
  heavyModel: string;
  /** 0 = không giới hạn lượt / ngày. */
  dailyCap: number;
}

/**
 * Sổ lượt dùng + khóa đang «nghỉ» — sống lâu hơn một KeyChainClient (đổi cài đặt dựng lại trợ lý mà không mất số đếm).
 * `onUse` / `onFailure` để kho lưu xuống DB; bài kiểm dùng bản không lưu.
 */
export class KeyUsageLedger {
  private readonly usage = new Map<number, { day: string; count: number }>();
  private readonly coolUntil = new Map<number, number>();

  constructor(
    private readonly onUse: (keyId: number, day: string) => void = () => undefined,
    private readonly onFailure: (keyId: number, problem: KeyProblem, at: number) => void = () => undefined,
  ) {}

  /** Nạp số lượt đã dùng hôm nay từ DB lúc khởi động. */
  seed(keyId: number, day: string, count: number): void {
    this.usage.set(keyId, { day, count });
  }

  usedOn(keyId: number, ms: number): number {
    const entry = this.usage.get(keyId);
    return entry && entry.day === vnDayKey(ms) ? entry.count : 0;
  }

  recordUse(keyId: number, ms: number): void {
    const day = vnDayKey(ms);
    const entry = this.usage.get(keyId);
    this.usage.set(keyId, { day, count: entry && entry.day === day ? entry.count + 1 : 1 });
    this.onUse(keyId, day);
  }

  recordFailure(keyId: number, problem: KeyProblem, ms: number): void {
    this.coolUntil.set(keyId, ms + KEY_COOLDOWN_MS);
    this.onFailure(keyId, problem, ms);
  }

  isCooling(keyId: number, ms: number): boolean {
    return (this.coolUntil.get(keyId) ?? 0) > ms;
  }
}

/** Thứ tự thử khóa lúc `ms`: bỏ khóa chạm trần hôm nay, khóa đang nghỉ xuống cuối hàng. Hàm thuần theo sổ. */
export function orderKeys(keys: ChainKey[], ledger: KeyUsageLedger, ms: number): ChainKey[] {
  const underCap = keys.filter((key) => key.dailyCap <= 0 || ledger.usedOn(key.id, ms) < key.dailyCap);
  return [...underCap.filter((key) => !ledger.isCooling(key.id, ms)), ...underCap.filter((key) => ledger.isCooling(key.id, ms))];
}

export const ALL_KEYS_CAPPED_TEXT = "Mọi khóa AI đã chạm trần lượt hôm nay (màn Cài đặt → Khóa AI).";

export class KeyChainClient implements ModelClient {
  private lastClient: { lastModel?: string; model: string } | null = null;
  readonly model: string;

  constructor(
    private readonly keys: ChainKey[],
    private readonly ledger: KeyUsageLedger,
    private readonly now: () => number = Date.now,
  ) {
    if (!keys.length) throw new Error("KeyChainClient cần ít nhất một khóa");
    this.model = keys[0].model;
  }

  /** Mô hình thật sự trả lời ở lần gọi gần nhất (ghi vào assistant_turn). */
  get lastModel(): string {
    return this.lastClient ? this.lastClient.lastModel ?? this.lastClient.model : this.model;
  }

  /** Tên mô hình AssistantService xin → tên mô hình của khóa đang thử. Bỏ trống = mô hình chính của khóa. */
  private modelFor(key: ChainKey, requested: string | undefined): string | undefined {
    if (requested !== HEAVY_MODEL_ALIAS) return undefined;
    return key.heavyModel && key.heavyModel !== key.model ? key.heavyModel : undefined;
  }

  private async run<T>(keys: ChainKey[], call: (key: ChainKey) => Promise<T>, countsAsFailure: (error: unknown) => boolean = () => true): Promise<T> {
    if (!keys.length) throw new Error(ALL_KEYS_CAPPED_TEXT);
    let lastError: unknown = null;
    for (const [index, key] of keys.entries()) {
      try {
        const result = await call(key);
        this.ledger.recordUse(key.id, this.now());
        this.lastClient = { lastModel: key.client.lastModel, model: key.model };
        return result;
      } catch (error) {
        lastError = error;
        if (!countsAsFailure(error)) continue;
        const problem = classifyKeyError(error);
        this.ledger.recordFailure(key.id, problem, this.now());
        const next = keys[index + 1];
        log.warn(`khóa AI ${key.label} lỗi — ${problem.label}${next ? `, chuyển sang ${next.label}` : ", hết khóa để thử"}: ${maskSecrets(error instanceof Error ? error.message : String(error)).slice(0, 300)}`);
      }
    }
    throw lastError;
  }

  generate(request: GenerateRequest): Promise<GeminiResult> {
    return this.run(orderKeys(this.keys, this.ledger, this.now()), (key) => key.client.generate({ ...request, model: this.modelFor(key, request.model) }));
  }

  readDocument(mime: string, data: Buffer, instruction: string, model?: string): Promise<DocumentReadResult> {
    const keys = orderKeys(this.keys, this.ledger, this.now()).filter((key) => key.client.readDocument);
    return this.run(keys, (key) => key.client.readDocument!(mime, data, instruction, this.modelFor(key, model)));
  }

  /** Tìm web chỉ có ở khóa Gemini — chuỗi không có khóa Gemini thì trợ lý không có công cụ tìm web. */
  get searchWeb(): ((query: string) => Promise<WebSearchResult>) | undefined {
    if (!this.keys.some((key) => key.client.searchWeb)) return undefined;
    return (query) => {
      const keys = orderKeys(this.keys, this.ledger, this.now()).filter((key) => key.client.searchWeb);
      // Gói miễn phí không có tìm web: đó là hạn mức TÌM KIẾM của khóa, không phải khóa hỏng — thử khóa Gemini kế, không đánh dấu lỗi
      return this.run(keys, (key) => key.client.searchWeb!(query), (error) => !(error instanceof WebSearchUnavailableError));
    };
  }
}
