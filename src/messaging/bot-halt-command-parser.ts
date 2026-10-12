import { foldKeepLength } from "../assistant/fold-text.js";

// Nhận diện câu lệnh tắt / bật / hỏi tình trạng bot (phase 9) — hàm THUẦN. Khớp TRỌN câu (neo ^…$, tối đa 6 chữ, có hoặc
// không dấu) để câu thường như «tắt bot đi em ơi rồi gửi báo cáo» không bị nuốt thành lệnh tắt khẩn.

export type BotHaltCommand = "halt" | "resume" | "status";

const MAX_WORDS = 6;

const HALT_PATTERNS = [/^\/?tatbot$/, /^tat bot( khan)?$/, /^dung bot$/, /^dung gui( tin)?$/, /^bot dung( lai)?$/, /^stop bot$/];
const RESUME_PATTERNS = [/^\/?batbot$/, /^bat bot$/, /^bat lai bot$/, /^mo bot$/, /^bot chay lai$/];
const STATUS_PATTERNS = [/^tinh trang bot$/, /^trang thai bot$/];

export function parseBotHaltCommand(text: string): BotHaltCommand | null {
  // Bỏ dấu câu cuối câu, gom khoảng trắng, hạ chữ thường — chỉ chữ / số / dấu «/» còn lại
  const folded = foldKeepLength(text).toLowerCase().replace(/[^a-z0-9/\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!folded || folded.split(" ").length > MAX_WORDS) return null;
  if (HALT_PATTERNS.some((pattern) => pattern.test(folded))) return "halt";
  if (RESUME_PATTERNS.some((pattern) => pattern.test(folded))) return "resume";
  if (STATUS_PATTERNS.some((pattern) => pattern.test(folded))) return "status";
  return null;
}
