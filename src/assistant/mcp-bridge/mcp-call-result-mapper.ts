import type { TurnEffects } from "../../data-access/turn-effects.js";
import { ERROR_META_KEY, TURN_META_KEY } from "../../mcp/mcp-meta-keys.js";

// Kết quả `callTool` của máy chủ trong tiến trình → thứ mô hình nhận (đúng hình công cụ cũ / công cụ lõi) + tác động của lượt (T5).
// `_meta.turn` luôn bị TÁCH ở đây: mã xác nhận, câu dựng sẵn… không bao giờ tới mô hình.

export interface CallToolResultLike {
  isError?: boolean;
  content?: unknown;
  structuredContent?: unknown;
  _meta?: unknown;
}

/** Phần của ToolContext mà tác động của lượt ghi vào (ToolContext thỏa cấu trúc này). */
export interface TurnEffectsSink {
  fixedReply?: string;
  filesToSend: number[];
  actionNotes?: string[];
  followUps?: string[];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const stringsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

export function readTurnEffects(meta: unknown): TurnEffects | null {
  const raw = isObject(meta) ? meta[TURN_META_KEY] : undefined;
  if (!isObject(raw)) return null;
  return {
    fixedReply: typeof raw.fixedReply === "string" ? raw.fixedReply : undefined,
    filesToSend: Array.isArray(raw.filesToSend) ? raw.filesToSend.filter((id): id is number => Number.isInteger(id)) : undefined,
    actionNotes: stringsOf(raw.actionNotes), followUps: stringsOf(raw.followUps),
  };
}

/** Ghi tác động vào lượt: câu dựng sẵn thay thế; tệp không trùng; ghi chú / tin kèm nối thêm. */
export function applyTurnEffects(sink: TurnEffectsSink, effects: TurnEffects): void {
  if (effects.fixedReply !== undefined) sink.fixedReply = effects.fixedReply;
  for (const id of effects.filesToSend ?? []) if (!sink.filesToSend.includes(id)) sink.filesToSend.push(id);
  if (effects.actionNotes?.length) sink.actionNotes = [...(sink.actionNotes ?? []), ...effects.actionNotes];
  if (effects.followUps?.length) sink.followUps = [...(sink.followUps ?? []), ...effects.followUps];
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((part) => (isObject(part) && typeof part.text === "string" ? part.text : "")).join("\n").trim();
}

/**
 * Đổi kết quả cho mô hình. Lỗi: có `_meta` lỗi → "object" `{ error: { code, message, allowed? } }` (như công cụ lõi) hoặc "string"
 * `{ error: "<chữ>" }` (như công cụ cũ của trợ lý); không có `_meta` (lỗi giao thức) → chữ của `content`. Thành công: `structuredContent`.
 */
export function mapCallToolResult(sink: TurnEffectsSink, result: CallToolResultLike, errorShape: "string" | "object" = "object"): Record<string, unknown> {
  const effects = readTurnEffects(result._meta);
  if (effects) applyTurnEffects(sink, effects);
  if (result.isError) {
    const payload = isObject(result._meta) ? result._meta[ERROR_META_KEY] : undefined;
    if (isObject(payload) && typeof payload.message === "string") {
      return errorShape === "string" ? { error: payload.message } : { error: { code: payload.code, message: payload.message, ...(payload.allowed ? { allowed: payload.allowed } : {}) } };
    }
    return { error: textOf(result.content) || "Công cụ lỗi" };
  }
  if (isObject(result.structuredContent)) return result.structuredContent;
  return { result: textOf(result.content) };
}
