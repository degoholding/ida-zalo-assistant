import { GeminiClient, type DocumentReadResult, type GeminiResult, type GenerateRequest, type ModelClient, type WebSearchResult } from "./gemini-client.js";
import { createLogger } from "../logger.js";
import { OpenAIClient } from "./openai-client.js";

const log = createLogger("ai");
/** OpenAI vừa lỗi (chế độ ưu tiên OpenAI) thì đi thẳng Gemini trong ngần này, khỏi mỗi câu hỏi chờ OpenAI hỏng trước. */
const OPENAI_COOLDOWN_MS = 10 * 60 * 1000;

// Chọn nhà cung cấp AI theo cài đặt «Nhà cung cấp AI» (07/10/2026):
// - gemini: chỉ Gemini (nghe ghi âm dài qua Files API, có tìm Google);
// - openai: chỉ OpenAI — Gemini tắt hẳn (không tìm web, ghi âm tối đa 25 MB);
// - openai_then_gemini: trả lời bằng OpenAI; OpenAI lỗi BẤT KỲ (khóa sai, hết tiền, quá tải) thì làm lại lượt đó bằng Gemini
//   — bot không chết vì một bên hỏng. Mỗi bên có bộ mô hình riêng (chính / việc nặng / dự phòng).

export type AiProvider = "gemini" | "openai" | "openai_then_gemini";

export interface ProviderModels {
  model: string;
  /** Rỗng = dùng mô hình chính. */
  heavyModel: string;
  fallbackModels: string[];
}

export interface ModelKeys {
  geminiKey: string;
  openaiKey: string;
  /** Địa chỉ API kiểu OpenAI; bỏ trống = api.openai.com. */
  openaiBaseUrl?: string;
}

export interface ModelPlan {
  provider: AiProvider;
  gemini: ProviderModels;
  openai: ProviderModels;
}

/** Khóa OpenAI (bắt đầu «sk-») dán nhầm vào ô Khóa Gemini — gặp thật 07/10/2026. */
export function looksLikeOpenAiKey(key: string): boolean {
  return /^sk-/.test(key.trim());
}

/** Chuẩn hóa hai khóa: khóa OpenAI nằm ở ô Gemini thì coi như khóa OpenAI (khi ô OpenAI trống). Hàm thuần. */
export function resolveModelKeys(keys: ModelKeys): ModelKeys {
  const geminiKey = keys.geminiKey.trim();
  const openaiKey = keys.openaiKey.trim();
  if (looksLikeOpenAiKey(geminiKey)) return { ...keys, geminiKey: "", openaiKey: openaiKey || geminiKey };
  return { ...keys, geminiKey, openaiKey };
}

/** Thiếu khóa cho nhà cung cấp đang chọn thì trả câu báo (log) thay vì dựng client sẽ lỗi mỗi câu hỏi. Hàm thuần. */
export function missingKeyProblem(provider: AiProvider, keys: ModelKeys): string | null {
  if (provider === "gemini" && !keys.geminiKey) return "đang chọn Gemini nhưng chưa có «Khóa Gemini»";
  if (provider === "openai" && !keys.openaiKey) return "đang chọn OpenAI nhưng chưa có «Khóa OpenAI»";
  if (provider === "openai_then_gemini" && !keys.openaiKey && !keys.geminiKey) return "chưa có khóa OpenAI lẫn khóa Gemini";
  return null;
}

/** Bộ mô hình của bên trả lời CHÍNH (AssistantService ghi log + chọn bản nặng theo bộ này). */
export function primaryModels(plan: ModelPlan, keys: ModelKeys): ProviderModels {
  const useOpenAi = plan.provider === "openai" || (plan.provider === "openai_then_gemini" && Boolean(keys.openaiKey));
  return useOpenAi ? plan.openai : plan.gemini;
}

export class ModelRouterClient implements ModelClient {
  private readonly gemini: GeminiClient | null;
  private readonly openai: OpenAIClient | null;
  private lastClient: { lastModel: string } | null = null;
  private openaiDownUntil = 0;
  readonly model: string;

  constructor(keys: ModelKeys, private readonly plan: ModelPlan, private readonly now: () => number = Date.now) {
    const wantsGemini = plan.provider !== "openai";
    const wantsOpenAi = plan.provider !== "gemini";
    this.gemini = wantsGemini && keys.geminiKey ? new GeminiClient(keys.geminiKey, plan.gemini.model, plan.gemini.fallbackModels) : null;
    this.openai = wantsOpenAi && keys.openaiKey
      ? new OpenAIClient(keys.openaiKey, plan.openai.model, plan.openai.fallbackModels, fetch, keys.openaiBaseUrl || undefined)
      : null;
    this.model = primaryModels(plan, keys).model;
  }

  /** Mô hình thật sự trả lời ở lần gọi gần nhất. */
  get lastModel(): string {
    return this.lastClient?.lastModel ?? this.model;
  }

  /** Lượt «nặng» của OpenAI → bản nặng tương ứng của Gemini khi phải lùi về Gemini. */
  private geminiModelFor(requested: string | undefined): string | undefined {
    const heavy = requested && requested === (this.plan.openai.heavyModel || undefined);
    return heavy ? this.plan.gemini.heavyModel || undefined : undefined;
  }

  /** Chạy bằng bên chính; ở chế độ ưu tiên OpenAI thì OpenAI lỗi → làm lại bằng Gemini. */
  private async run<T>(openaiCall: (client: OpenAIClient) => Promise<T>, geminiCall: (client: GeminiClient) => Promise<T>): Promise<T> {
    const canFallBack = Boolean(this.gemini);
    if (this.openai && (!canFallBack || this.now() >= this.openaiDownUntil)) {
      try {
        const result = await openaiCall(this.openai);
        this.lastClient = this.openai;
        return result;
      } catch (error) {
        if (!canFallBack) throw error;
        // Lùi về Gemini — lỗi OpenAI vẫn ghi lại để quản trị biết khóa / tài khoản đang có vấn đề
        this.openaiDownUntil = this.now() + OPENAI_COOLDOWN_MS;
        log.warn(`OpenAI lỗi, dùng Gemini 10 phút rồi thử lại: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!this.gemini) throw new Error(missingKeyProblem(this.plan.provider, { geminiKey: "", openaiKey: "" }) ?? "chưa có khóa AI");
    const result = await geminiCall(this.gemini);
    this.lastClient = this.gemini;
    return result;
  }

  generate(request: GenerateRequest): Promise<GeminiResult> {
    return this.run(
      (client) => client.generate(request),
      (client) => client.generate({ ...request, model: this.openai ? this.geminiModelFor(request.model) : request.model }),
    );
  }

  readDocument(mime: string, data: Buffer, instruction: string, model?: string): Promise<DocumentReadResult> {
    return this.run(
      (client) => client.readDocument(mime, data, instruction, model),
      (client) => client.readDocument(mime, data, instruction, this.openai ? this.geminiModelFor(model) : model),
    );
  }

  /** Tìm web chỉ có ở Gemini (Google Search) — chế độ «chỉ OpenAI» thì không có công cụ tìm web. */
  get searchWeb(): ((query: string) => Promise<WebSearchResult>) | undefined {
    const gemini = this.gemini;
    return gemini ? (query) => gemini.searchWeb(query) : undefined;
  }
}
