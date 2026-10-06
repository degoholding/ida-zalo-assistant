// Dòng đo token gắn dưới mỗi câu trả lời (cài đặt «Hiện số token dưới câu trả lời», 06/10/2026) — để thử mô hình và
// ước chi phí. Dòng này KHÔNG được đưa lại vào ngữ cảnh cho mô hình ở câu sau (stripTokenFooter).

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  model: string;
}

// Khớp cả dạng gọn hiện tại «[3k token]» lẫn dạng chi tiết cũ «[Token: … vào · … ra …]» (tin đã gửi trước 06/10 11:40)
const FOOTER_PATTERN = /\n*\[(?:<?\d+k token|Token: [^\]\n]*)\]\s*$/;

/** Gọn theo yêu cầu (06/10/2026): chỉ tổng token vào + ra, làm tròn nghìn — «[3k token]», dưới 1.000 là «[<1k token]». */
export function formatTokenFooter(usage: TurnUsage): string {
  const total = usage.inputTokens + usage.outputTokens;
  return total < 1000 ? "[<1k token]" : `[${Math.round(total / 1000)}k token]`;
}

export function appendTokenFooter(text: string, usage: TurnUsage): string {
  return `${text}\n\n${formatTokenFooter(usage)}`;
}

/** Bỏ dòng đo token khỏi câu trả lời cũ trước khi đưa làm lịch sử / ngữ cảnh cho mô hình. */
export function stripTokenFooter(text: string): string {
  return text.replace(FOOTER_PATTERN, "");
}
