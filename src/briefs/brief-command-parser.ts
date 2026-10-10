import { foldKeepLength } from "../assistant/fold-text.js";
import type { BriefPeriodVariant } from "./brief-period.js";

// Đọc câu chat gọi bản tin / báo cáo NGAY (phase 4) — hàm thuần, chạy TRƯỚC mô hình như chat-commands.ts /
// task-command-parser.ts. Câu phải NGẮN và khớp TRỌN (neo ^…$): «báo cáo tuần doanh số đại lý A ra Excel» không khớp —
// để công cụ AI export_report / send_brief lo (câu dài hơn, có thêm điều kiện). Không đọc tham số nào từ câu (không như
// lệnh việc/ticket) nên dùng thẳng chuỗi đã bỏ dấu, không cần giữ độ dài để cắt chuỗi gốc.

export type BriefRequestKind = "morning" | "evening" | "auto" | "weekly" | "monthly";

export interface BriefCommand {
  kind: "brief_request";
  request: BriefRequestKind;
  /** "current" chỉ có ý nghĩa với tuần / tháng (brief-period.ts) — bản tin sáng / cuối ngày luôn "standard". */
  variant: BriefPeriodVariant;
}

/** Câu quá ngần này ký tự chắc chắn không phải một cụm gọi bản tin ngắn — bỏ qua luôn, khỏi thử regex. */
const MAX_LEN = 60;

const PRONOUN = "anh|chi|em|toi|minh";
/** «gửi anh», «cho anh (xem)», «xem», «lấy», «làm» — tiền tố cho phép trước cụm bản tin / báo cáo. */
const PREFIX = String.raw`(?:(?:gui|cho)\s+(?:${PRONOUN})(?:\s+xem)?\s+|xem\s+|lay\s+|lam\s+)?`;
/** «nhé», «nha», «giúp anh» — đuôi cho phép sau cụm. */
const SUFFIX = String.raw`(?:\s+(?:nhe|nha|giup\s+(?:${PRONOUN})))?`;

const anchor = (core: string): RegExp => new RegExp(String.raw`^${PREFIX}${core}${SUFFIX}$`);

const MORNING = anchor(String.raw`ban tin sang(?:\s+(?:nay|hom nay))?`);
const EVENING = anchor(String.raw`ban tin\s+(?:cuoi ngay|chieu|toi)`);
/** «bản tin» trần (có thể kèm «hôm nay») — sáng hay cuối ngày tùy giờ gọi, quyết ở runBriefCommand (có `now`, parser
 * không có). TRƯỚC ĐÂY «bản tin hôm nay» khớp nhầm EVENING ở trên (coi «hôm nay» = buổi tối) nên gọi buổi sáng lại ra
 * bản cuối ngày — review phase 8, Low. */
const BARE_BRIEF = anchor(String.raw`ban tin(?:\s+hom nay)?`);
const PERIOD_SUFFIX = String.raw`(truoc|vua roi|nay|ky nay)`;
const WEEKLY = anchor(String.raw`(?:bao cao|bc)\s+tuan(?:\s+${PERIOD_SUFFIX})?`);
const MONTHLY = anchor(String.raw`(?:bao cao|bc)\s+thang(?:\s+${PERIOD_SUFFIX})?`);

/** «này» / «kỳ này» = kỳ CHƯA xong (tới hiện tại); còn lại (kể cả không ghi gì) = kỳ TRƯỚC đã xong (mặc định). */
const variantOf = (suffix: string | undefined): BriefPeriodVariant => (suffix === "nay" || suffix === "ky nay" ? "current" : "standard");

/** Đọc một câu chat thành lệnh bản tin / báo cáo; không khớp thì null (để lệnh khác / mô hình AI xử lý). */
export function parseBriefCommand(input: string): BriefCommand | null {
  const normalized = input.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?…]+$/u, "").trim();
  if (!normalized || normalized.length > MAX_LEN) return null;
  const folded = foldKeepLength(normalized);

  if (MORNING.test(folded)) return { kind: "brief_request", request: "morning", variant: "standard" };
  if (EVENING.test(folded)) return { kind: "brief_request", request: "evening", variant: "standard" };
  if (BARE_BRIEF.test(folded)) return { kind: "brief_request", request: "auto", variant: "standard" };
  let match = folded.match(WEEKLY);
  if (match) return { kind: "brief_request", request: "weekly", variant: variantOf(match[1]) };
  match = folded.match(MONTHLY);
  if (match) return { kind: "brief_request", request: "monthly", variant: variantOf(match[1]) };
  return null;
}

/** Lệnh bản tin (trong ChatCommand chung). */
export const isBriefCommand = (command: { kind: string } | null | undefined): command is BriefCommand => command?.kind === "brief_request";
