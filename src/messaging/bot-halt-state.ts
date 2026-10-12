// Trạng thái «tắt bot khẩn» (khóa ẩn `bot_halt` trong app_setting → config.botHalt). Tệp thuần, không import gì để
// config.ts và setting-registry.ts dùng chung mà không vòng.

export type BotHaltVia = "zalo" | "web" | "";

export interface BotHaltState {
  halted: boolean;
  /** ISO 8601 lúc tắt; null khi đang bật */
  since: string | null;
  /** Tên người tắt */
  by: string;
  via: BotHaltVia;
}

export const BOT_RUNNING: BotHaltState = { halted: false, since: null, by: "", via: "" };

/** Chuẩn hóa giá trị đọc từ DB — hỏng / thiếu thì coi như bot đang bật. */
export function normalizeBotHaltState(value: unknown): BotHaltState {
  if (!value || typeof value !== "object") return { ...BOT_RUNNING };
  const raw = value as Record<string, unknown>;
  if (raw.halted !== true) return { ...BOT_RUNNING };
  const since = typeof raw.since === "string" && !Number.isNaN(Date.parse(raw.since)) ? raw.since : new Date(0).toISOString();
  return { halted: true, since, by: typeof raw.by === "string" ? raw.by : "", via: raw.via === "zalo" || raw.via === "web" ? raw.via : "" };
}
