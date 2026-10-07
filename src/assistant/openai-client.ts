import OpenAI, { toFile } from "openai";
import type { DocumentReadResult, FunctionDeclaration, GeminiContent, GeminiResult, GenerateRequest, ModelClient } from "./gemini-client.js";

// Gọi OpenAI (Chat Completions + gọi hàm) qua SDK chính thức `openai`, cùng giao diện ModelClient với GeminiClient
// (07/10/2026 — quản trị mua khóa OpenAI). Lịch sử hội thoại trong bot giữ dạng Gemini (role user/model, parts functionCall / functionResponse);
// lớp này đổi qua lại: lượt gọi hàm → assistant.tool_calls (mang id OpenAI trong part.callId), kết quả hàm → role "tool"
// theo đúng thứ tự lệnh gọi. Ghi âm: gỡ băng bằng /audio/transcriptions rồi mới đưa chữ cho mô hình tóm tắt.

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 120_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);
/** SDK tự thử lại 1 lần lỗi tạm thời; hết thì vòng dự phòng của lớp này đổi sang mô hình khác. */
const SDK_MAX_RETRIES = 1;
/** Giới hạn tệp của endpoint gỡ băng. */
export const OPENAI_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
const TRANSCRIBE_MODEL = "gpt-4o-transcribe";

export class OpenAIHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Lỗi OpenAI có lẫn một phần khóa («Incorrect API key provided: sk-ab…») — che đi trước khi vào log / bảng assistant_turn. */
export function maskApiKeys(text: string): string {
  return text.replace(/sk-[A-Za-z0-9*_-]+/g, "sk-***");
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type ChatMessage =
  | { role: "system" | "user"; content: string | Record<string, unknown>[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Hội thoại dạng Gemini → messages của Chat Completions. Hàm thuần. */
export function toChatMessages(system: string, contents: GeminiContent[]): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: system }];
  let pendingIds: string[] = [];
  contents.forEach((content, turn) => {
    if (content.role === "model") {
      const text = content.parts.map((part) => part.text ?? "").join("").trim();
      const calls = content.parts.filter((part) => part.functionCall);
      pendingIds = calls.map((part, index) => (typeof part.callId === "string" ? part.callId : `call_${turn}_${index}`));
      messages.push({
        role: "assistant",
        content: text || null,
        ...(calls.length ? {
          tool_calls: calls.map((part, index) => ({
            id: pendingIds[index], type: "function" as const,
            function: { name: part.functionCall!.name, arguments: JSON.stringify(part.functionCall!.args ?? {}) },
          })),
        } : {}),
      });
      return;
    }
    const texts: string[] = [];
    content.parts.forEach((part) => {
      if (part.functionResponse) {
        // Kết quả hàm khớp lệnh gọi theo thứ tự — vòng hỏi đáp trả kết quả đúng thứ tự lệnh gọi
        const id = pendingIds.shift() ?? `call_${turn}_orphan`;
        messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(part.functionResponse.response) });
      } else if (part.text) {
        texts.push(part.text);
      }
    });
    if (texts.length) messages.push({ role: "user", content: texts.join("\n") });
  });
  return messages;
}

/** Lượt trả lời của OpenAI → lượt «model» dạng Gemini (giữ id lệnh gọi trong callId). Hàm thuần. */
export function fromChatMessage(message: { content?: string | null; tool_calls?: ToolCall[] | null }): GeminiContent {
  const parts: GeminiContent["parts"] = [];
  if (message.content) parts.push({ text: message.content });
  for (const call of message.tool_calls ?? []) {
    if (call.type !== "function") continue;
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(call.function.arguments || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      // Mô hình trả JSON hỏng: gọi hàm với tham số rỗng — công cụ tự báo thiếu tham số cho mô hình sửa
    }
    parts.push({ functionCall: { name: call.function.name, args }, callId: call.id });
  }
  return { role: "model", parts: parts.length ? parts : [{ text: "" }] };
}

const toTools = (tools: FunctionDeclaration[]) =>
  tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));

export class OpenAIClient implements ModelClient {
  /** Mô hình thật sự trả lời ở lần gọi gần nhất (khác model chính khi đã chuyển sang dự phòng). */
  lastModel: string;
  private readonly sdk: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly fallbackModels: string[] = [],
    fetcher: typeof fetch = fetch,
    /** Khóa mua qua bên bán lại thì gọi địa chỉ của họ (cùng chuẩn API OpenAI). */
    baseUrl: string = OPENAI_DEFAULT_BASE_URL,
  ) {
    this.lastModel = model;
    this.sdk = new OpenAI({
      apiKey, baseURL: baseUrl.replace(/\/+$/, ""), fetch: fetcher, maxRetries: SDK_MAX_RETRIES, timeout: REQUEST_TIMEOUT_MS,
    });
  }

  async generate(request: GenerateRequest): Promise<GeminiResult> {
    const messages = toChatMessages(request.system, request.contents) as OpenAI.Chat.ChatCompletionMessageParam[];
    const tools = request.tools.length
      ? { tools: toTools(request.tools) as OpenAI.Chat.ChatCompletionTool[], tool_choice: request.forceText ? ("none" as const) : ("auto" as const) }
      : {};
    const completion = await this.withFallback(request.model ?? this.model, (model) => this.sdk.chat.completions.create({ model, messages, ...tools }));
    const message = completion.choices[0]?.message;
    if (!message) throw new Error("OpenAI trả về rỗng");
    return {
      content: fromChatMessage({ content: message.content, tool_calls: (message.tool_calls ?? []) as ToolCall[] }),
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    };
  }

  async readDocument(mime: string, data: Buffer, instruction: string, model?: string): Promise<DocumentReadResult> {
    if (mime.startsWith("audio/")) return this.readAudio(mime, data, instruction, model);
    const dataUrl = `data:${mime};base64,${data.toString("base64")}`;
    const part = mime === "application/pdf"
      ? { type: "file", file: { filename: "tai-lieu.pdf", file_data: dataUrl } }
      : { type: "image_url", image_url: { url: dataUrl } };
    return this.complete([{ role: "user", content: [part, { type: "text", text: instruction }] }], model);
  }

  /** Ghi âm: gỡ băng → mô hình làm theo chỉ dẫn (tóm tắt, quyết định, phân công…) trên bản gỡ băng. */
  private async readAudio(mime: string, data: Buffer, instruction: string, model?: string): Promise<DocumentReadResult> {
    if (data.length > OPENAI_AUDIO_MAX_BYTES) {
      throw new Error(`Ghi âm ${Math.round(data.length / 1024 / 1024)} MB — OpenAI chỉ gỡ băng tệp tối đa 25 MB (cắt nhỏ, hoặc dùng khóa Gemini để nghe tệp dài).`);
    }
    const ext = mime.split("/")[1]?.replace("mpeg", "mp3").replace("mp4", "m4a") || "mp3";
    const transcript = await this.call(async () => this.sdk.audio.transcriptions.create({
      file: await toFile(data, `ghi-am.${ext}`, { type: mime }), model: TRANSCRIBE_MODEL, language: "vi",
    }));
    const text = (typeof transcript === "string" ? transcript : String((transcript as { text?: string }).text ?? "")).trim();
    const usage = (transcript as { usage?: { input_tokens?: number; output_tokens?: number } }).usage ?? {};
    const summary = await this.complete([{ role: "user", content: `${instruction}\n\nBẢN GỠ BĂNG (máy tự gỡ):\n${text}` }], model);
    return {
      // Giữ cả bản gỡ băng gốc phía dưới — mô hình hỏi đáp cần chi tiết, không chỉ bản tóm
      text: `${summary.text}\n\nGỠ BĂNG GỐC:\n${text}`,
      inputTokens: summary.inputTokens + (usage.input_tokens ?? 0),
      outputTokens: summary.outputTokens + (usage.output_tokens ?? 0),
    };
  }

  private async complete(messages: ChatMessage[], model?: string): Promise<DocumentReadResult> {
    const completion = await this.withFallback(model ?? this.model, (name) =>
      this.sdk.chat.completions.create({ model: name, messages: messages as OpenAI.Chat.ChatCompletionMessageParam[] }));
    return {
      text: String(completion.choices[0]?.message?.content ?? "").trim(),
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    };
  }

  /** Mô hình quá tải / hết hạn mức (429, 5xx) thì lần lượt thử mô hình dự phòng; lỗi khác (khóa sai, tên mô hình sai) báo ngay. */
  private async withFallback<T>(first: string, run: (model: string) => Promise<T>): Promise<T> {
    const models = [first, ...this.fallbackModels.filter((name) => name !== first)];
    let lastError: unknown;
    for (const model of models) {
      try {
        const result = await this.call(() => run(model));
        this.lastModel = model;
        return result;
      } catch (error) {
        lastError = error;
        if (!(error instanceof OpenAIHttpError) || !RETRYABLE_STATUSES.has(error.status)) throw error;
      }
    }
    throw lastError;
  }

  /** Lỗi của SDK → OpenAIHttpError (mã HTTP + câu báo đã che khóa). */
  private async call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        const status = error.status ?? 0;
        throw new OpenAIHttpError(status, maskApiKeys(`OpenAI ${status || "lỗi mạng"}: ${error.message}`).slice(0, 400));
      }
      throw error;
    }
  }
}
