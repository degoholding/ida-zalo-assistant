import { foldText } from "../alerts/keyword-matcher.js";
import type { GuardedDraft, RawDraft } from "./reply-suggestion-types.js";

// Kiểm SAU SINH bản nháp (phase 10 — N2, IDA câu 12: không tự điền số). Mô hình có thể bịa giá / ngày / số lượng dù lời nhắc cấm,
// nên máy chủ quét lại: mọi số tiền, số + đơn vị / thời hạn, ngày, giờ, thứ, số lô, mã chữ-số, số trần ≥ 2 chữ số mà KHÔNG có trong nguồn
// (mẫu + tin gốc + ngữ cảnh + câu người hỏi) bị thay «[cần bổ sung]». Chỗ trống «[...]» mô hình chưa điền cũng thành
// «[cần bổ sung: ...]». Số dạng chữ («hai trăm nghìn») không bắt được — rủi ro đã ghi ở plan.

export const NEED_FILL = "[cần bổ sung]";
export const NEED_TECH = "[cần kỹ thuật xác nhận]";
export const AGRO_NOTICE = "Câu hỏi kỹ thuật — cần phòng kỹ thuật xác nhận trước khi trả lời khách.";

const SEP = String.raw`\d+(?:[.,]\d+)*`;
const NOT_IN_WORD = String.raw`(?![\p{L}\d])`;
const WEEKDAY_WORDS: Record<string, string> = { hai: "2", ba: "3", tu: "4", nam: "5", sau: "6", bay: "7" };

// Thứ tự = độ ưu tiên (regex chọn nhánh khớp đầu tiên tại cùng vị trí): ngày > giờ > tiền > số + đơn vị (cả thời hạn «3 ngày») > thứ
// > số lô > mã chữ-số (mã đơn «DH123», quy cách «500SC») > số trần.
const TOKEN_PATTERN = new RegExp([
  String.raw`(?<date>(?:ngày\s+)?\d{1,2}\/\d{1,2}(?:\/\d{2,4})?${NOT_IN_WORD}|ngày\s+\d{1,2}${NOT_IN_WORD})`,
  String.raw`(?<time>(?<![\p{L}\d])\d{1,2}\s?(?:h|giờ)(?:\d{2})?${NOT_IN_WORD}|(?<![\p{L}\d])\d{1,2}:\d{2}${NOT_IN_WORD})`,
  String.raw`(?<money>(?<![\p{L}\d])${SEP}\s?(?:đồng|đ|vnđ|vnd|nghìn|ngàn|triệu|tỷ|tr|k)${NOT_IN_WORD})`,
  String.raw`(?<qty>(?<![\p{L}\d])${SEP}\s?(?:%|(?:bao|chai|thùng|kg|tấn|lít|gói|hộp|can|ml|gam|cc|ngày|tuần|tháng|năm|tiếng)${NOT_IN_WORD}))`,
  String.raw`(?<week>(?<![\p{L}\d])(?:thứ\s+(?:[2-7]|hai|ba|tư|năm|sáu|bảy)|chủ\s+nhật)${NOT_IN_WORD})`,
  String.raw`(?<lot>(?<![\p{L}\d])(?:số\s+)?lô\s+[A-Za-z]*\d[\w-]*)`,
  String.raw`(?<code>(?<![\p{L}\d])(?:[A-Za-z]{1,8}[-_.]?\d{2,}|\d{2,}[A-Za-z]{1,6})[A-Za-z0-9-]*${NOT_IN_WORD})`,
  String.raw`(?<bare>(?<![\p{L}\d])\d{2,}(?:[.,]\d+)*${NOT_IN_WORD})`,
].join("|"), "giu");

const DOSE_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\d])\d+(?:[.,]\d+)?\s?(?:ml|cc|gam|g|kg|lít|l)\s?(?:\/|trên|cho)\s?(?:bình|ha|sào|công|lít|phuy)${NOT_IN_WORD}`, "giu");

const PLACEHOLDER = /\[([^\]\n]{1,80})\]/g;
const MASK_TAG = /^(?:SĐT|CCCD|STK)\b/;

/** Cụm hứa hẹn — có trong bản nháp mà mẫu không có thì ghi «Lưu ý» (không tự xóa). */
export const PROMISE_PHRASES = ["hoàn tiền", "bồi thường", "miễn phí", "giảm giá", "chiết khấu", "đổi trả", "cam kết", "đảm bảo"];

interface Token {
  start: number;
  end: number;
  key: string;
}

/** «1.250.000» → «1250000»; «1,5» (1–2 chữ số sau dấu cuối) coi là số thập phân → «1.5». */
function numberKey(raw: string): string {
  const match = /^\d+(?:[.,]\d+)*/.exec(raw.trim());
  const number = match ? match[0] : raw;
  if (/[.,]\d{1,2}$/.test(number)) {
    const cut = Math.max(number.lastIndexOf("."), number.lastIndexOf(","));
    return `${number.slice(0, cut).replace(/\D/g, "")}.${number.slice(cut + 1)}`;
  }
  return number.replace(/\D/g, "");
}

const stripZeros = (digits: string) => digits.replace(/^0+(?=\d)/, "");

/**
 * Khóa so khớp của một token — hai chuỗi cùng nghĩa (9h = 9h00 = 9:00; 05/10 = 5/10) cho cùng khóa. `forSource` = token nằm trong
 * NGUỒN: nguồn cho phép rộng hơn (ngày «12/10» cho phép «ngày 12»; tiền «250k» cho phép số trần «250»), còn token trong NHÁP chỉ mang
 * khóa chặt (nháp «12/11» không ăn theo «12/10» của nguồn; nháp «200k» không ăn theo «200 bao»).
 */
function keysOf(kind: string, raw: string, forSource: boolean): string[] {
  const text = raw.toLowerCase();
  switch (kind) {
    case "date": {
      const dm = /(\d{1,2})\/(\d{1,2})/.exec(text);
      if (dm) return forSource ? [`d:${stripZeros(dm[1])}/${stripZeros(dm[2])}`, `dd:${stripZeros(dm[1])}`] : [`d:${stripZeros(dm[1])}/${stripZeros(dm[2])}`];
      const day = /(\d{1,2})/.exec(text);
      return [`dd:${stripZeros(day?.[1] ?? "")}`];
    }
    case "time": {
      const parts = /(\d{1,2})\D*(\d{2})?/.exec(text);
      return [`t:${stripZeros(parts?.[1] ?? "")}:${parts?.[2] ?? "00"}`];
    }
    case "week": {
      const word = foldText(text).replace(/^ *thu */, "").trim();
      return [`w:${/^[2-7]$/.test(word) ? word : WEEKDAY_WORDS[word] ?? "cn"}`];
    }
    case "lot":
      return [`l:${text.replace(/^(?:số\s+)?lô\s+/, "")}`];
    case "code":
      return [`c:${text.replace(/[-_.]/g, "")}`];
    case "money":
      return forSource ? [`m:${numberKey(raw)}`, `n:${numberKey(raw)}`] : [`m:${numberKey(raw)}`];
    default:
      return [`n:${numberKey(raw)}`];
  }
}

function scan(text: string, forSource: boolean, skip: [number, number][] = []): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    if (skip.some(([from, to]) => start >= from && start < to)) continue;
    const kind = Object.entries(match.groups ?? {}).find(([, value]) => value !== undefined)?.[0] ?? "bare";
    for (const key of keysOf(kind, match[0], forSource)) tokens.push({ start, end: start + match[0].length, key });
  }
  return tokens;
}

function bracketSpans(text: string): [number, number][] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length] as [number, number]);
}

export interface GuardOptions {
  /** Câu hỏi / tin gốc là kỹ thuật BVTV → mọi liều / pha thành «[cần kỹ thuật xác nhận]». */
  agro: boolean;
  /** Nội dung mẫu đã chọn — cụm hứa hẹn có sẵn trong mẫu thì không cảnh báo. */
  templateBody: string;
}

/**
 * Kiểm một bản nháp so với `sources` (mẫu + tin gốc + ngữ cảnh + câu hỏi). Số có nguồn giữ nguyên; không nguồn → «[cần bổ sung]».
 * Hàm thuần.
 */
export function guardDraft(draft: RawDraft, sources: string[], options: GuardOptions): GuardedDraft {
  const allowed = new Set(sources.flatMap((source) => scan(source, true, bracketSpans(source)).map((token) => token.key)));
  let text = draft.text;
  let technical = 0;
  if (options.agro) {
    text = text.replace(DOSE_PATTERN, () => {
      technical += 1;
      return NEED_TECH;
    });
  }
  // Đổi từ cuối về đầu để vị trí các token còn lại không lệch; một vị trí có thể có nhiều khóa (ngày → d + dd) — giữ nếu BẤT KỲ khóa có nguồn.
  const spans = bracketSpans(text);
  const byStart = new Map<number, Token[]>();
  for (const token of scan(text, false, spans)) byStart.set(token.start, [...(byStart.get(token.start) ?? []), token]);
  let replaced = 0;
  for (const [start, group] of [...byStart.entries()].sort((a, b) => b[0] - a[0])) {
    if (group.some((token) => allowed.has(token.key))) continue;
    text = `${text.slice(0, start)}${NEED_FILL}${text.slice(group[0].end)}`;
    replaced += 1;
  }
  text = text.replace(PLACEHOLDER, (whole, inner: string) => {
    const label = inner.trim();
    if (whole === NEED_FILL || whole === NEED_TECH || label.startsWith("cần bổ sung") || label.startsWith("cần kỹ thuật")) return whole;
    replaced += 1;
    return MASK_TAG.test(label) ? NEED_FILL : `[cần bổ sung: ${label}]`;
  });
  const folded = foldText(text);
  const templateFolded = foldText(options.templateBody);
  const warnings = PROMISE_PHRASES.filter((phrase) => {
    const key = foldText(phrase).trim();
    return folded.includes(` ${key} `) && !templateFolded.includes(` ${key} `);
  });
  return { tone: draft.tone, text, replaced, technical, warnings };
}
