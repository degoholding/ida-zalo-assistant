import { BriefKind } from "../constants.js";
import { detectAnomalies } from "./periodic-report-anomalies.js";
import type { MetricPair, PeriodicReportData, ReportMeta } from "./periodic-report-types.js";
import { vnTimestamp } from "./report-exporter.js";
import type { ReportSheet, ReportTable } from "./report-table.js";

// Bảng Excel của báo cáo tuần / tháng (phase 3) — hàm THUẦN, chỉ đọc `PeriodicReportData` đã gom sẵn (phạm vi Mật đã
// áp dụng từ lúc gom, bảng này không lọc lại). Tab chính «Theo nhóm» (notes = các số tổng); tab phụ «Theo nhân viên»,
// «Việc», «Ticket», «Bất thường».

const TITLE: Record<BriefKind.Weekly | BriefKind.Monthly, string> = {
  [BriefKind.Weekly]: "Báo cáo tuần", [BriefKind.Monthly]: "Báo cáo tháng",
};

const metricLine = (label: string, pair: MetricPair, unit = ""): string =>
  `${label}: ${pair.current}${unit} (kỳ trước ${pair.previous}${unit})`;

/** Các số tổng — ghi đầu tab chính «Theo nhóm» (notes của ReportTable). */
function summaryNotes(data: PeriodicReportData, meta: ReportMeta): string[] {
  const t = data.totals;
  return [
    `Người nhận: ${meta.recipientName} · Phạm vi: ${meta.scopeLabel}`,
    metricLine("Tin", t.messages), metricLine("Khẩn", t.urgent), metricLine("Quan trọng", t.important),
    metricLine("Tin chờ quá giờ còn mở cuối kỳ", t.waitingOverdueOpen),
    metricLine("Phản hồi trung vị", t.responseMedianMinutes, " phút"), metricLine("Phản hồi trung bình", t.responseAverageMinutes, " phút"),
    metricLine("Việc tạo", t.tasksCreated), metricLine("Việc xong", t.tasksDone), metricLine("Việc xong trễ", t.tasksDoneLate),
    metricLine("Việc quá hạn còn mở", t.tasksOverdueOpen),
    metricLine("Ticket tạo", t.ticketsCreated), metricLine("Ticket đóng", t.ticketsClosed), metricLine("Ticket còn mở", t.ticketsOpen),
  ];
}

const workRows = (rows: PeriodicReportData["tasks"]): (string | number)[][] =>
  rows.map((row) => [row.code, row.title, row.groupName || "(riêng)", row.personName, row.status, vnTimestamp(row.at).text]);

const WORK_COLUMNS = ["Mã", "Việc", "Nhóm", "Người", "Trạng thái", "Thời điểm"];

/** `PeriodicReportData` (đã gom, đã áp luật Mật) → `ReportTable` cho `buildReportWorkbook` (report-table.ts). */
export function toPeriodicReportTable(data: PeriodicReportData, meta: ReportMeta): ReportTable {
  const extraSheets: ReportSheet[] = [
    {
      title: "Theo nhân viên", columns: ["Nhân viên", "Tin gửi", "Tin đã trả lời", "Việc xong", "Việc quá hạn"],
      rows: data.staff.map((row) => [row.name, row.messagesSent, row.messagesHandled, row.tasksDone, row.tasksOverdue]),
    },
    { title: "Việc", columns: WORK_COLUMNS, rows: workRows(data.tasks) },
    { title: "Ticket", columns: WORK_COLUMNS, rows: workRows(data.tickets) },
    { title: "Bất thường", columns: ["Bất thường"], rows: detectAnomalies(data).map((text) => [text]) },
  ];
  return {
    title: TITLE[data.kind],
    period: data.period.periodLabel,
    notes: summaryNotes(data, meta),
    columns: ["Nhóm", "Tin", "Tin kỳ trước", "Khẩn", "Chờ quá giờ còn mở", "Phản hồi TB (phút)"],
    rows: data.groups.map((group) => [group.groupName, group.messages, group.previousMessages, group.urgent, group.waitingOverdueOpen, group.responseAverageMinutes]),
    extraSheets,
  };
}
