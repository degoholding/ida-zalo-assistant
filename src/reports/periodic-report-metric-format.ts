import { formatMetricChange, formatMetricValue, metricSummary } from "../briefs/brief-metric-format.js";
import type { PeriodicMetricSummary } from "./periodic-report-types.js";
import type { ReportSheet } from "./report-table.js";

// Chữ + bảng của phần «Số liệu» trong báo cáo tuần / tháng: dòng tóm tắt, khối PDF nhỏ, sheet Excel. Hàm THUẦN.

/** Số chỉ tiêu tối đa trên dòng tóm tắt / khối PDF (PDF vẫn đúng 1 trang). */
export const MAX_SUMMARY_METRICS = 4;
const SHEET_TITLE = "Số liệu";

/** «Số liệu: Doanh số 2,1 tỷ (▲8%) · Tồn kho 3.420 bao (▼5%)» — dòng cho chữ tóm tắt gửi kèm. */
export function metricSummaryLine(summary: PeriodicMetricSummary): string {
  const parts = summary.metrics.slice(0, MAX_SUMMARY_METRICS).map((metric) => {
    const change = formatMetricChange(metric.changePct);
    return `${metric.label} ${formatMetricValue(metric.current, metric.unit)}${change ? ` (${change})` : ""}`;
  });
  const flagged = summary.flaggedCount > 0 ? ` · ${summary.flaggedCount} số cần xác nhận` : "";
  return `Số liệu: ${parts.join(" · ")}${flagged}`;
}

/** Các dòng của khối PDF «Số liệu» (≤ 4 chỉ tiêu + tối đa 1 dòng cờ = ≤ 5 dòng ngắn). */
export function metricPdfLines(summary: PeriodicMetricSummary): string[] {
  const lines = summary.metrics.slice(0, MAX_SUMMARY_METRICS)
    .map((metric) => metricSummary(metric.label, metric.current, metric.unit, metric.changePct, "so kỳ trước"));
  return summary.flaggedCount > 0 ? [...lines, `${summary.flaggedCount} số cần xác nhận`] : lines;
}

/**
 * Sheet «Số liệu»: mỗi NV một dòng, mỗi chỉ tiêu 3 cột (kỳ này / kỳ trước / %); dòng TỔNG; rồi các dòng «Khu vực: …».
 * (Khu vực tách dòng riêng vì một NV có thể báo nhiều khu vực.)
 */
export function metricSheet(summary: PeriodicMetricSummary): ReportSheet {
  const columns = ["Nhân viên / khu vực", ...summary.metrics.flatMap((metric) => {
    const unit = metric.unit ? ` (${metric.unit})` : "";
    return [`${metric.label}${unit} kỳ này`, `${metric.label} kỳ trước`, `${metric.label} %`];
  })];
  const cells = (figures: PeriodicMetricSummary["staff"][number]["figures"]) => summary.metrics.flatMap((metric) => {
    const figure = figures[metric.code];
    return figure ? [figure.current, figure.previous ?? "", figure.changePct ?? ""] : ["", "", ""];
  });
  const total = summary.metrics.flatMap((metric) => [metric.current, metric.previous ?? "", metric.changePct ?? ""]);
  return {
    title: SHEET_TITLE,
    columns,
    rows: [
      ...summary.staff.map((row) => [`${row.name}${row.flagged ? " (cần xác nhận)" : ""}`, ...cells(row.figures)]),
      ["TỔNG", ...total],
      ...summary.areas.map((row) => [`Khu vực: ${row.name}`, ...cells(row.figures)]),
    ],
  };
}
