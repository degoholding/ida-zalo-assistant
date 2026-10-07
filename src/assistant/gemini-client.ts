// Gọi Gemini qua REST (generateContent + gọi hàm). Không dùng SDK để khỏi thêm phụ thuộc.
//
// ⚠️ Lượt của mô hình phải đưa NGUYÊN VẸN trở lại lịch sử (kể cả các phần thoughtSignature của
// dòng Gemini 3): bóc riêng functionCall ra rồi dựng lại là API từ chối lượt gọi hàm kế tiếp.
import { INLINE_MAX_BYTES, deleteGeminiFile, uploadGeminiFile } from "./gemini-files.js";

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  [key: string]: unknown;
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GeminiResult {
  content: GeminiContent;
  inputTokens: number;
  outputTokens: number;
}

export interface WebSearchResult {
  text: string;
  sources: { title: string; url: string }[];
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateRequest {
  system: string;
  contents: GeminiContent[];
  tools: FunctionDeclaration[];
  /** Mô hình muốn dùng cho lượt này (vd bản nặng khi tóm tắt dài); bỏ trống = mô hình chính. */
  model?: string;
  /** Cấm gọi công cụ lượt này (functionCallingConfig NONE) — buộc trả lời bằng chữ với dữ liệu đã có. */
  forceText?: boolean;
}

export interface DocumentReadResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelClient {
  generate(request: GenerateRequest): Promise<GeminiResult>;
  /** Đọc tài liệu nhị phân (pdf, ảnh) thành chữ. Không có thì bot chỉ đọc được tệp văn bản. */
  readDocument?(mime: string, data: Buffer, instruction: string, model?: string): Promise<DocumentReadResult>;
  /** Tìm web bằng Google Search (grounding). Không có thì trợ lý không có công cụ tìm web. */
  searchWeb?(query: string): Promise<WebSearchResult>;
}

/** Tìm web bị từ chối vì khóa chưa có hạn mức tìm kiếm (gói miễn phí không có Google Search). */
export class WebSearchUnavailableError extends Error {}

const REQUEST_TIMEOUT_MS = 90_000;
// Lỗi tạm thời của Google (quá tải 503, vượt hạn mức 429, lỗi trong 500): thử lại rồi mới đổi mô hình
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const RETRY_DELAYS_MS = [1000];
// Mô hình dự phòng vừa trả lời được thì dùng thẳng nó trong ngần này, khỏi chờ mô hình chính lỗi lại.
// Đo thật 01/10/2026: không có chỗ nhớ này, mỗi câu hỏi mất 50–100 giây chờ mô hình chính quá tải.
const PREFER_FALLBACK_MS = 10 * 60 * 1000;

class GeminiHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// Lượt nào do mô hình nào sinh ra — để biết khi nào phải viết lại lịch sử thành chữ thường
const producedBy = new WeakMap<GeminiContent, string>();

/**
 * Viết lại cho `model` đọc được: lượt gọi hàm do MÔ HÌNH KHÁC sinh ra thành chữ thường, kèm luôn lượt
 * kết quả hàm ngay sau nó. Lý do: dòng Gemini 3 đòi chữ ký suy nghĩ (thoughtSignature) trên mọi lượt
 * gọi hàm, mà chữ ký chỉ mô hình gốc mới có — bỏ chữ ký đi thì API báo 400 (gặp thật 01/10/2026).
 */
function adaptHistory(contents: GeminiContent[], model: string): GeminiContent[] {
  const result: GeminiContent[] = [];
  let convertNextResponses = false;
  for (const content of contents) {
    const author = producedBy.get(content);
    // Không có nhãn = lượt do nhà cung cấp khác sinh (OpenAI, chế độ «ưu tiên OpenAI» lùi về Gemini giữa chừng)
    if (content.role === "model" && author !== model && content.parts.some((part) => part.functionCall)) {
      const lines = content.parts.map((part) => part.functionCall
        ? `(Đã gọi công cụ ${part.functionCall.name} với tham số ${JSON.stringify(part.functionCall.args ?? {})})`
        : part.text ?? "").filter(Boolean);
      result.push({ role: "model", parts: [{ text: lines.join("\n") }] });
      convertNextResponses = true;
      continue;
    }
    if (content.role === "user" && convertNextResponses && content.parts.some((part) => part.functionResponse)) {
      const lines = content.parts.map((part) => part.functionResponse
        ? `Kết quả công cụ ${part.functionResponse.name}: ${JSON.stringify(part.functionResponse.response)}`
        : part.text ?? "").filter(Boolean);
      result.push({ role: "user", parts: [{ text: lines.join("\n") }] });
      convertNextResponses = false;
      continue;
    }
    convertNextResponses = false;
    result.push(content);
  }
  return result;
}

export class GeminiClient implements ModelClient {
  /** Mô hình thật sự trả lời ở lần gọi gần nhất (khác model chính khi đã chuyển sang dự phòng). */
  lastModel: string;
  private preferred: { model: string; until: number } | null = null;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fallbackModels: string[] = [],
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.lastModel = model;
  }

  async generate(request: GenerateRequest): Promise<GeminiResult> {
    const base = [this.model, ...this.fallbackModels.filter((name) => name && name !== this.model)];
    // Lượt nặng (tóm tắt dài, đọc tệp) đi bản nặng trước; hỏng thì vẫn rơi về chuỗi thường
    const ordered = request.model ? [request.model, ...base.filter((name) => name !== request.model)] : base;
    const preferred = this.preferred && this.preferred.until > this.clock() ? this.preferred.model : null;
    const models = preferred ? [preferred, ...ordered.filter((name) => name !== preferred)] : ordered;
    let lastError: unknown = null;
    for (const [index, model] of models.entries()) {
      const contents = adaptHistory(request.contents, model);
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          const result = await this.call(model, { ...request, contents });
          producedBy.set(result.content, model);
          this.lastModel = model;
          if (model === this.model) this.preferred = null;
          // Chỉ đặt mốc lúc vừa CHUYỂN sang dự phòng; đang dùng sẵn thì không gia hạn — hết hạn là
          // phải thử lại mô hình chính, kẻo kẹt ở dự phòng mãi. Bản nặng được YÊU CẦU chạy được thì không phải
          // dự phòng (lỗi cũ 07/10/2026: một lượt đọc tệp xong, 10 phút sau mọi câu hỏi thường đều chạy bản nặng).
          else if (model !== preferred && model !== request.model) this.preferred = { model, until: this.clock() + PREFER_FALLBACK_MS };
          return result;
        } catch (error) {
          lastError = error;
          const retryable = error instanceof GeminiHttpError ? RETRYABLE_STATUSES.has(error.status)
            : error instanceof Error && error.name === "TimeoutError";
          // 404 = mô hình không còn / không mở cho khóa này; 429 = hết hạn mức của mô hình này (gói miễn phí
          // hết rất nhanh — gặp thật 01/10/2026). Cả hai: sang ngay mô hình kế tiếp, thử lại chỉ phí thời gian.
          const skipModel = error instanceof GeminiHttpError && (error.status === 404 || error.status === 429);
          if (skipModel && index < models.length - 1) break;
          if (!retryable) throw error;
          if (attempt < RETRY_DELAYS_MS.length) await this.sleep(RETRY_DELAYS_MS[attempt]);
        }
      }
    }
    throw lastError;
  }

  /**
   * Một lượt gọi RIÊNG có bật Google Search, tách khỏi vòng gọi công cụ chính — chưa kiểm được việc
   * trộn google_search với functionDeclarations trong cùng lượt. Gói miễn phí không có tìm web
   * (đo 01/10/2026: mọi mô hình trả 429); gói trả phí có 5.000 lượt/tháng, sau đó tính tiền.
   */
  async searchWeb(query: string): Promise<WebSearchResult> {
    const models = [this.model, ...this.fallbackModels.filter((name) => name && name !== this.model)];
    let lastError: unknown = null;
    for (const model of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: "Tìm trên web và trả lời bằng tiếng Việt, ngắn gọn, nêu số liệu cụ thể và thời điểm của thông tin." }] },
              contents: [{ role: "user", parts: [{ text: query }] }],
              tools: [{ google_search: {} }],
            }),
          },
        );
        const body = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
          candidates?: { content?: GeminiContent; groundingMetadata?: { groundingChunks?: { web?: { title?: string; uri?: string } }[] } }[];
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
        };
        if (response.status === 429) throw new WebSearchUnavailableError("hết hạn mức tìm web");
        if (!response.ok || body.error) throw new GeminiHttpError(response.status, `Tìm web ${model} ${response.status}: ${body.error?.message ?? ""}`.slice(0, 300));
        const candidate = body.candidates?.[0];
        const usage = body.usageMetadata ?? {};
        return {
          text: (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join("").trim(),
          sources: (candidate?.groundingMetadata?.groundingChunks ?? [])
            .map((chunk) => ({ title: chunk.web?.title ?? "", url: chunk.web?.uri ?? "" }))
            .filter((source) => source.title || source.url)
            .slice(0, 5),
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
        };
      } catch (error) {
        lastError = error;
        // Hết hạn mức tìm web là theo KHÓA, không theo mô hình — thử mô hình khác cũng vô ích
        if (error instanceof WebSearchUnavailableError) throw error;
      }
    }
    throw lastError;
  }

  /**
   * Đọc pdf / ảnh: gửi tệp inline cho mô hình kèm câu lệnh «chép lại chữ». Dùng bản nặng (đọc tài liệu
   * cần nhìn kỹ hơn trò chuyện); hỏng thì thử các mô hình còn lại. Tối đa ~20 MB theo giới hạn Gemini.
   */
  async readDocument(mime: string, data: Buffer, instruction: string, model?: string): Promise<DocumentReadResult> {
    const base = [this.model, ...this.fallbackModels.filter((name) => name && name !== this.model)];
    const models = model ? [model, ...base.filter((name) => name !== model)] : base;
    // Tệp lớn (ghi âm cuộc họp dài…) không gửi inline được — tải lên Files API một lần, mọi mô hình dùng chung
    const uploaded = data.length > INLINE_MAX_BYTES ? await uploadGeminiFile(this.apiKey, mime, data, `bot-tro-ly-${Date.now()}`) : null;
    const filePart = uploaded
      ? { fileData: { mimeType: mime, fileUri: uploaded.uri } }
      : { inlineData: { mimeType: mime, data: data.toString("base64") } };
    // Âm thanh dài: gỡ băng một giờ họp có thể mất vài phút
    const timeoutMs = mime.startsWith("audio/") ? 10 * 60_000 : REQUEST_TIMEOUT_MS * 2;
    try {
      return await this.readWithModels(models, filePart, instruction, timeoutMs);
    } finally {
      if (uploaded) await deleteGeminiFile(this.apiKey, uploaded.name);
    }
  }

  private async readWithModels(models: string[], filePart: Record<string, unknown>, instruction: string, timeoutMs: number): Promise<DocumentReadResult> {
    let lastError: unknown = null;
    for (const name of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
            signal: AbortSignal.timeout(timeoutMs),
            body: JSON.stringify({
              contents: [{ role: "user", parts: [filePart, { text: instruction }] }],
              generationConfig: { temperature: 0 },
            }),
          },
        );
        const body = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
          candidates?: { content?: GeminiContent }[];
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
        };
        if (!response.ok || body.error) throw new GeminiHttpError(response.status, `Gemini ${name} ${response.status}: ${body.error?.message ?? "không rõ lỗi"}`.slice(0, 400));
        const text = (body.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("").trim();
        if (!text) throw new Error("Mô hình không đọc ra chữ nào");
        this.lastModel = name;
        const usage = body.usageMetadata ?? {};
        return { text, inputTokens: usage.promptTokenCount ?? 0, outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) };
      } catch (error) {
        lastError = error;
        const skip = error instanceof GeminiHttpError && (error.status === 404 || error.status === 429 || RETRYABLE_STATUSES.has(error.status));
        if (!skip) throw error;
      }
    }
    throw lastError;
  }

  private async call(model: string, request: GenerateRequest): Promise<GeminiResult> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        // Khóa đi trong tiêu đề, KHÔNG đặt trên URL (URL hay lọt vào log)
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: request.contents,
          tools: request.tools.length ? [{ functionDeclarations: request.tools }] : undefined,
          toolConfig: request.forceText && request.tools.length ? { functionCallingConfig: { mode: "NONE" } } : undefined,
          generationConfig: { temperature: 0.3 },
        }),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: number; message?: string };
      candidates?: { content?: GeminiContent; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
      promptFeedback?: { blockReason?: string };
    };
    if (!response.ok || body.error) {
      throw new GeminiHttpError(response.status, `Gemini ${model} ${response.status}: ${body.error?.message ?? "không rõ lỗi"}`.slice(0, 400));
    }
    const candidate = body.candidates?.[0];
    if (!candidate?.content?.parts?.length) {
      const reason = body.promptFeedback?.blockReason ?? candidate?.finishReason ?? "không có nội dung";
      throw new Error(`Gemini không trả lời (${reason})`);
    }
    const usage = body.usageMetadata ?? {};
    return {
      content: { role: "model", parts: candidate.content.parts },
      inputTokens: usage.promptTokenCount ?? 0,
      // Token suy nghĩ cũng tính tiền như token đầu ra
      outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
    };
  }
}
