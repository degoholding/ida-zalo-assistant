import { foldText } from "../alerts/keyword-matcher.js";
import { ReplyTemplateStatus } from "../constants.js";
import type { ReplyTemplate } from "./reply-suggestion-types.js";

// Chọn mẫu ứng viên (phase 10 — N2): máy chủ chấm điểm, mô hình chỉ chọn 1 trong ≤ 3 ứng viên (bằng id). Chỉ mẫu ĐÃ DUYỆT vào được
// — kiểm lại ở đây dù repository đã lọc, để không có đường nào đưa mẫu chưa duyệt cho mô hình.

export const MAX_CANDIDATES = 3;
const KEYWORD_SCORE = 3;
const TOKEN_SCORE = 1;
const MIN_TOKEN_LENGTH = 3;

/** Từ rỗng (đã bỏ dấu) — xuất hiện ở mọi câu «trả lời tin…» nên không phân biệt được mẫu. */
const STOP_WORDS = new Set(["anh", "chi", "em", "giup", "tra", "loi", "tin", "khach", "cho", "cua", "nay", "mau", "tinh", "huong"]);

export interface PickedTemplate {
  template: ReplyTemplate;
  score: number;
}

function significantTokens(text: string): string[] {
  return foldText(text).split(" ").filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(token));
}

/**
 * Chấm điểm mẫu theo `text` (= câu người hỏi + chữ tin gốc), gấp dấu:
 * mỗi từ khóa (nguyên cụm) khớp +3; mỗi token tên / tình huống (≥ 3 ký tự, bỏ từ rỗng) có trong text +1. Trả ≤ 3 mẫu điểm > 0,
 * điểm cao trước, bằng điểm thì id nhỏ trước. Hàm thuần.
 */
export function pickTemplates(templates: ReplyTemplate[], text: string): PickedTemplate[] {
  const folded = foldText(text);
  const textTokens = new Set(folded.split(" ").filter(Boolean));
  const picked: PickedTemplate[] = [];
  for (const template of templates) {
    if (template.status !== ReplyTemplateStatus.Approved) continue;
    let score = 0;
    for (const keyword of template.keywords) {
      const key = foldText(keyword).trim();
      if (key && folded.includes(` ${key} `)) score += KEYWORD_SCORE;
    }
    for (const token of new Set(significantTokens(`${template.name} ${template.situation}`))) {
      if (textTokens.has(token)) score += TOKEN_SCORE;
    }
    if (score > 0) picked.push({ template, score });
  }
  picked.sort((a, b) => b.score - a.score || a.template.id - b.template.id);
  return picked.slice(0, MAX_CANDIDATES);
}
