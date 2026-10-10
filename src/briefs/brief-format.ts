import { vnLocalTime } from "../schedule/work-calendar.js";
import type { Bucket, BriefLine } from "./brief-types.js";

// Chữ hiển thị thuần cho bản tin (phase 2, IDA câu 24): thứ/ngày, giờ, đoạn trích, dòng tin / việc / ticket, một mục
// («… và N nữa» khi vượt trần hiển thị). Khuôn soạn cả bài (`composeMorningBrief` / `composeEveningBrief`) ở brief-compose.ts.

const WEEKDAY_LABELS = ["", "T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const DAY_MS = 86_400_000;
/** Mỗi mục bản tin tối đa bấy nhiêu dòng chi tiết (chốt 09/10/2026) — dư thì gộp «… và N nữa». */
export const BRIEF_SECTION_LIMIT = 3;

/** «T6 09/10» — thứ + ngày/tháng giờ VN. */
export function dayLabel(at: Date): string {
  const local = vnLocalTime(at);
  const [, month, day] = local.date.split("-");
  return `${WEEKDAY_LABELS[local.weekday]} ${day}/${month}`;
}

/** «16:40» giờ VN. */
export function clock(at: Date): string {
  const local = vnLocalTime(at);
  const hours = String(Math.floor(local.minuteOfDay / 60)).padStart(2, "0");
  const minutes = String(local.minuteOfDay % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Cắt chữ còn tối đa `max` ký tự, gộp khoảng trắng thừa — đoạn trích hiển thị trong một dòng bản tin. */
export function snippet(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export interface CappedBucket<T> {
  shown: T[];
  more: number;
}

/** Top N dòng hiển thị + số dòng còn lại ngoài top N (dựa vào `total` thật, không phải `items.length`). */
export function capBucket<T>(bucket: Bucket<T>, limit = BRIEF_SECTION_LIMIT): CappedBucket<T> {
  return { shown: bucket.items.slice(0, limit), more: Math.max(0, bucket.total - limit) };
}

/** Một dòng tin: «   - [K52] Lan 16:40: hàng lô 3 cháy lá…». `groupName` rỗng (tin riêng) → «riêng». */
export function briefLine(line: BriefLine): string {
  return `   - [${line.groupName || "riêng"}] ${line.senderName || "?"} ${clock(line.at)}: ${snippet(line.text)}`;
}

/** «quá N ngày» (so NGÀY giờ VN, không so giờ); «quá hạn» khi cùng ngày hôm nay (hạn hôm nay đã quá nhưng chưa sang ngày). */
export function overdueDays(dueAt: Date, now: Date): string {
  const days = Math.floor((vnLocalTime(now).dayStartMs - vnLocalTime(dueAt).dayStartMs) / DAY_MS);
  return days >= 1 ? `quá ${days} ngày` : "quá hạn";
}

/** Một dòng việc: «V-12 Mai · hợp đồng thép · quá 2 ngày». `detail` = ghi chú cuối dòng (quá N ngày / hạn hôm nay / hạn mai). */
export function taskLine(line: BriefLine, detail: string): string {
  return `   - V-${line.ref} ${line.senderName || "chưa giao"} · ${snippet(line.text, 40)} · ${detail}`;
}

/** Một dòng ticket: «T-8 Đổi hàng lỗi · Tuấn». */
export function ticketLine(line: BriefLine): string {
  return `   - T-${line.ref} ${snippet(line.text, 40)} · ${line.senderName || "?"}`;
}

/**
 * Một mục bản tin: tiêu đề + tối đa `limit` dòng đã soạn sẵn + «… và N nữa» nếu `total` lớn hơn số dòng đưa vào.
 * `lines` phải đã được cắt theo cùng `limit` trước khi gọi (compose gộp nhiều bucket thì tự cắt tổng). Rỗng (`total`
 * = 0) → một dòng «không có» thay vì mảng rỗng (mỗi mục luôn chiếm ít nhất một dòng, theo yêu cầu khuôn bản tin).
 */
export function section(title: string, lines: string[], total: number, limit = BRIEF_SECTION_LIMIT): string[] {
  if (!total) return [title, "   không có"];
  const shown = lines.slice(0, limit);
  const more = total - shown.length;
  return [title, ...shown, ...(more > 0 ? [`   … và ${more} nữa`] : [])];
}
