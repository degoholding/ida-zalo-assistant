import { briefLine, clock, dayLabel, overdueDays, section, taskLine, ticketLine } from "./brief-format.js";
import type { TaskBuckets, TicketBuckets } from "./brief-work-collectors.js";
import type { Bucket, BriefHighlight, BriefLine } from "./brief-types.js";

// Soạn chữ bản tin sáng / cuối ngày (phase 2, IDA câu 24, chốt 09/10/2026) — hàm THUẦN, không chạm DB / AI; dữ liệu đã
// gom sẵn (phase 1 bộ gom + điểm tin AI) đưa vào qua `BriefComposeData`. 5 mục, mỗi mục ≤ 3 dòng + «… và N nữa», mục
// rỗng «không có»; cả bài ≤ ~25 dòng / 1.500 ký tự để vừa một màn điện thoại.

export interface BriefComposeData {
  /** KHẨN / quan trọng CHƯA xử lý trong kỳ. */
  urgentOpen: Bucket<BriefLine>;
  /** Số KHẨN đã xử lý trong kỳ — chỉ cuối ngày hiện «đã xử lý X»; bản sáng truyền 0 (không hiện). */
  urgentHandledCount: number;
  waitingOverdue: Bucket<BriefLine>;
  /** Tin còn chờ nhưng CHƯA quá giờ — chỉ cuối ngày dùng; bản sáng truyền bucket rỗng. */
  waitingOpen: Bucket<BriefLine>;
  tasks: TaskBuckets;
  tickets: TicketBuckets;
  /** Ý điểm tin AI đã chọn (rỗng nếu bỏ mục 5 — xem `aiNote`). */
  highlights: BriefHighlight[];
  /** Vì sao không có điểm tin AI (tắt cài đặt / chưa khóa / chạm trần / lỗi / không có tin) — rỗng = có điểm tin. */
  aiNote: string;
}

export interface BriefComposeContext {
  recipientName: string;
  now: Date;
}

const FOOTER = "Xem đủ: màn Bản tin trên web";

function highlightSection(highlights: BriefHighlight[], title: string): string[] {
  const lines = highlights.slice(0, 3).map((highlight) =>
    `   - ${highlight.text} [${highlight.line.groupName || "riêng"} · ${highlight.line.senderName || "?"} · ${clock(highlight.line.at)}]`);
  return [title, ...lines];
}

/** Mục 5 «Điểm tin» — bỏ hẳn (không hiện cả tiêu đề) khi `aiNote` khác rỗng, theo chốt 09/10/2026. */
function highlightLines(data: BriefComposeData, title: string): string[] {
  return data.aiNote || !data.highlights.length ? [] : highlightSection(data.highlights, title);
}

/** «BẢN TIN SÁNG T6 09/10 — anh Duoc» (1) KHẨN/quan trọng CHƯA xử lý — carry-over tối đa 7 ngày, không chỉ từ chiều qua,
 * xem `urgentOpen` (brief-message-collectors.ts, review phase 8 H2) (2) chờ quá giờ (3) việc (4) ticket (5) điểm tin hôm qua. */
export function composeMorningBrief(data: BriefComposeData, ctx: BriefComposeContext): string {
  const taskItems = [
    ...data.tasks.overdue.items.map((line) => taskLine(line, overdueDays(line.at, ctx.now))),
    ...data.tasks.dueToday.items.map((line) => taskLine(line, "hạn hôm nay")),
  ];
  const lines = [
    `BẢN TIN SÁNG ${dayLabel(ctx.now)} — ${ctx.recipientName}`,
    ...section(`1. KHẨN/quan trọng chưa xử lý: ${data.urgentOpen.total}`, data.urgentOpen.items.map(briefLine), data.urgentOpen.total),
    ...section(`2. Tin chờ trả lời quá giờ: ${data.waitingOverdue.total}`, data.waitingOverdue.items.map(briefLine), data.waitingOverdue.total),
    ...section(`3. Việc: ${data.tasks.overdue.total} quá hạn, ${data.tasks.dueToday.total} hạn hôm nay`, taskItems,
      data.tasks.overdue.total + data.tasks.dueToday.total),
    ...section(`4. Ticket mở: ${data.tickets.open.total} (${data.tickets.newInPeriod.total} mới)`,
      data.tickets.open.items.map(ticketLine), data.tickets.open.total),
    ...highlightLines(data, "5. Điểm tin hôm qua"),
    FOOTER,
  ];
  return lines.join("\n");
}

/** Cuối ngày: cùng khung cho HÔM NAY — khẩn đã/chưa xử lý, tin còn chờ (quá giờ lên trước), việc xong/quá hạn/hạn mai, ticket. */
export function composeEveningBrief(data: BriefComposeData, ctx: BriefComposeContext): string {
  const waitingTotal = data.waitingOverdue.total + data.waitingOpen.total;
  const waitingItems = [...data.waitingOverdue.items, ...data.waitingOpen.items].map(briefLine);
  const taskItems = [
    ...data.tasks.overdue.items.map((line) => taskLine(line, overdueDays(line.at, ctx.now))),
    ...data.tasks.dueNextWorkingDay.items.map((line) => taskLine(line, "hạn mai")),
  ];
  const lines = [
    `BẢN TIN CUỐI NGÀY ${dayLabel(ctx.now)} — ${ctx.recipientName}`,
    ...section(`1. KHẨN hôm nay: ${data.urgentOpen.total + data.urgentHandledCount} (đã xử lý ${data.urgentHandledCount}, còn ${data.urgentOpen.total})`,
      data.urgentOpen.items.map(briefLine), data.urgentOpen.total),
    ...section(`2. Tin còn chờ trả lời: ${waitingTotal} (${data.waitingOverdue.total} quá giờ)`, waitingItems, waitingTotal),
    ...section(`3. Việc: ${data.tasks.doneInPeriod.total} xong hôm nay · ${data.tasks.overdue.total} còn quá hạn · ${data.tasks.dueNextWorkingDay.total} hạn mai`,
      taskItems, data.tasks.overdue.total + data.tasks.dueNextWorkingDay.total),
    ...section(`4. Ticket: ${data.tickets.newInPeriod.total} mới · ${data.tickets.closedInPeriod.total} đóng · ${data.tickets.open.total} còn mở`,
      data.tickets.newInPeriod.items.map(ticketLine), data.tickets.newInPeriod.total),
    ...highlightLines(data, "5. Điểm tin hôm nay"),
    FOOTER,
  ];
  return lines.join("\n");
}
