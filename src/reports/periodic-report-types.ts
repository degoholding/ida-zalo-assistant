import type { BriefKind } from "../constants.js";
import type { BriefPeriod } from "../briefs/brief-types.js";

// Kiểu dữ liệu của báo cáo tuần / tháng (phase 3, chốt 09/10/2026) — thuần, không phụ thuộc DB / pdfmake / xlsx. Bộ gom
// (periodic-report-message-stats.ts, periodic-report-work-stats.ts) dựng `PeriodicReportData`; khuôn PDF
// (periodic-report-template.ts) và bảng Excel (periodic-report-workbook.ts) chỉ ĐỌC kiểu này.

/** Một số kèm số của kỳ trước — để hiện mũi tên ▲▼ trên khuôn PDF / ghi chú Excel. */
export interface MetricPair {
  current: number;
  previous: number;
}

export interface PeriodicReportTotals {
  messages: MetricPair;
  urgent: MetricPair;
  important: MetricPair;
  /** Tin chờ trả lời quá giờ nhắc, còn mở TẠI THỜI ĐIỂM cuối kỳ (xem Risks phase-03: ước lượng từ trạng thái hiện tại). */
  waitingOverdueOpen: MetricPair;
  responseMedianMinutes: MetricPair;
  responseAverageMinutes: MetricPair;
  tasksCreated: MetricPair;
  tasksDone: MetricPair;
  tasksDoneLate: MetricPair;
  tasksOverdueOpen: MetricPair;
  ticketsCreated: MetricPair;
  ticketsClosed: MetricPair;
  ticketsOpen: MetricPair;
}

/** Một dòng «Theo nhóm» — chỉ các nhóm có tin kỳ này HOẶC kỳ trước (nhóm im lặng hẳn hai kỳ thì không đáng liệt kê). */
export interface GroupReportRow {
  groupName: string;
  messages: number;
  previousMessages: number;
  urgent: number;
  waitingOverdueOpen: number;
  responseAverageMinutes: number;
}

/** Một dòng «Theo nhân viên» — tạm: contact có vai trò (`contact.role ≠ None`) đã gửi tin trong phạm vi kỳ này. */
export interface StaffReportRow {
  name: string;
  messagesSent: number;
  messagesHandled: number;
  tasksDone: number;
  tasksOverdue: number;
}

/** Một dòng trong danh sách việc / ticket của kỳ (sheet phụ Excel). */
export interface WorkReportRow {
  code: string;
  title: string;
  groupName: string;
  personName: string;
  status: string;
  at: Date;
}

/** Một chỉ tiêu số liệu (phase 5 của Phase 10): tổng kỳ này + kỳ trước. `previous` / `changePct` null = kỳ trước không có số. */
export interface MetricFigure {
  code: string;
  label: string;
  unit: string;
  current: number;
  previous: number | null;
  changePct: number | null;
}

/** Một dòng bảng NV (hoặc khu vực) × chỉ tiêu — `figures` theo `code`, thiếu = không có số. */
export interface MetricBreakdownRow {
  name: string;
  flagged: boolean;
  figures: Record<string, { current: number; previous: number | null; changePct: number | null }>;
}

/** Số liệu từ bảng Drive trong kỳ báo cáo — vắng (`undefined`) khi chưa có nguồn / kỳ không có số → ẩn hẳn khỏi tóm tắt, PDF, Excel. */
export interface PeriodicMetricSummary {
  metrics: MetricFigure[];
  staff: MetricBreakdownRow[];
  areas: MetricBreakdownRow[];
  /** Số NV có dòng bị gắn cờ */
  flaggedCount: number;
}

export interface PeriodicReportData {
  kind: BriefKind.Weekly | BriefKind.Monthly;
  period: BriefPeriod;
  totals: PeriodicReportTotals;
  groups: GroupReportRow[];
  staff: StaffReportRow[];
  tasks: WorkReportRow[];
  tickets: WorkReportRow[];
  metrics?: PeriodicMetricSummary;
}

/** Thông tin ngoài số liệu — người nhận, phạm vi, giờ lập — để khuôn PDF / Excel ghi đầu trang. */
export interface ReportMeta {
  recipientName: string;
  /** «Mọi nhóm» hoặc tên các nhóm đã chọn, đã cắt cho vừa một dòng. */
  scopeLabel: string;
  now: Date;
}
