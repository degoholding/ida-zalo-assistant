import { ReplyTone } from "../constants.js";
import { AGRO_NOTICE } from "./reply-fact-guard.js";
import type { SuggestionResult } from "./reply-suggestion-types.js";

// Dựng chữ trả lời của máy chủ (phase 10 — N2): MỘT tin đầu (nguồn + hướng dẫn + lưu ý) và mỗi bản nháp MỘT tin riêng, chỉ có nội dung,
// để người dùng bấm giữ → chép đúng một bản. Mô hình chính không diễn đạt lại (sẽ làm mất «[cần bổ sung]»).

const TONE_LABEL: Record<ReplyTone, string> = {
  [ReplyTone.Formal]: "lịch sự",
  [ReplyTone.Friendly]: "thân thiện",
  [ReplyTone.Brief]: "ngắn gọn",
};
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const VN_OFFSET_MS = 7 * 3_600_000;
const SOURCE_QUOTE_MAX = 120;
const LISTED_TEMPLATES_MAX = 10;

/** «09:12 T2 12/10» theo giờ Việt Nam. */
export function formatSourceTime(date: Date): string {
  const local = new Date(date.getTime() + VN_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} ${WEEKDAYS[local.getUTCDay()]} ${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}`;
}

function quote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SOURCE_QUOTE_MAX ? `${flat.slice(0, SOURCE_QUOTE_MAX)}…` : flat;
}

export interface FormattedSuggestion {
  /** Tin đầu: tên mẫu, tin gốc, hướng dẫn, số chỗ cần bổ sung, lưu ý. */
  header: string;
  /** Mỗi phần tử = một tin = một bản nháp (chỉ nội dung). */
  drafts: string[];
}

export function formatSuggestion(result: SuggestionResult): FormattedSuggestion {
  const lines = [`GỢI Ý TRẢ LỜI — theo mẫu «${result.templateName}»`];
  if (result.source) {
    const { source } = result;
    lines.push(`Tin gốc: [${source.groupName} · ${source.senderName} · ${formatSourceTime(source.sentAt)}] «${quote(source.text)}»`);
  }
  const order = result.drafts.map((draft, index) => `(${index + 1}) ${TONE_LABEL[draft.tone]}`).join(" · ");
  lines.push(`Em gửi ${result.drafts.length} bản nháp ngay dưới, mỗi bản một tin: ${order} — anh/chị bấm giữ để chép rồi tự gửi bằng Zalo của mình. Em KHÔNG gửi đi đâu.`);
  const fills = result.drafts.reduce((sum, draft) => sum + draft.replaced, 0);
  if (fills > 0) lines.push(`Chỗ «[cần bổ sung]» (${fills} chỗ): điền số đúng trước khi gửi.`);
  const techs = result.drafts.reduce((sum, draft) => sum + draft.technical, 0);
  if (techs > 0) lines.push(`Chỗ «[cần kỹ thuật xác nhận]» (${techs} chỗ): hỏi phòng kỹ thuật trước khi gửi.`);
  if (result.agro) lines.push(AGRO_NOTICE);
  result.drafts.forEach((draft, index) => {
    if (!draft.warnings.length) return;
    lines.push(`Lưu ý: bản ${index + 1} có ${draft.warnings.map((word) => `«${word}»`).join(", ")} — mẫu không có, kiểm trước khi gửi.`);
  });
  return { header: lines.join("\n"), drafts: result.drafts.map((draft) => draft.text) };
}

/** Không có mẫu ĐÃ DUYỆT hợp → từ chối + liệt kê mẫu đang dùng (chốt 12/10: KHÔNG soạn tự do). */
export function formatNoTemplateReply(approvedNames: string[]): string {
  if (!approvedNames.length) {
    return "Chưa có mẫu ĐÃ DUYỆT nào trong thư viện nên em chưa soạn gợi ý được. Anh/chị soạn mẫu ở màn Mẫu tin trên web (quản lý duyệt xong em mới dùng).";
  }
  const listed = approvedNames.slice(0, LISTED_TEMPLATES_MAX).map((name) => `«${name}»`).join(", ");
  const more = approvedNames.length > LISTED_TEMPLATES_MAX ? `, … (${approvedNames.length} mẫu)` : "";
  return `Chưa có mẫu ĐÃ DUYỆT hợp tình huống này. Mẫu đang dùng: ${listed}${more}. Anh/chị soạn mẫu mới ở màn Mẫu tin trên web (quản lý duyệt xong em mới dùng).`;
}
