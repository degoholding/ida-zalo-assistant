import type { PeriodicReportData } from "./periodic-report-types.js";

// Bất thường của báo cáo tuần / tháng (phase 3, chốt 09/10/2026) — hàm THUẦN, chỉ đọc `PeriodicReportData` đã gom sẵn.
// Năm luật, ưu tiên theo mức nghiêm trọng (khẩn tăng trước, tin chờ quá giờ sau cùng); tối đa 5 ý hiện trên khuôn PDF.

const MAX_ANOMALIES = 5;
const MAX_TEXT_CHARS = 140;
/** Nhóm có phản hồi TB ≥ ngần này lần mức chung mới coi là bất thường. */
const RESPONSE_OUTLIER_FACTOR = 2;
/** Việc quá hạn còn mở từ ngần này trở lên mới đáng báo. */
const TASKS_OVERDUE_THRESHOLD = 5;
/** Tin KHẨN tăng từ ngần này (30%) so kỳ trước mới đáng báo. */
const URGENT_GROWTH_RATIO = 0.3;

const clamp = (text: string) => (text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS - 1)}…` : text);

function urgentGrowthAnomaly(data: PeriodicReportData): string[] {
  const { current, previous } = data.totals.urgent;
  const grew = previous > 0 ? (current - previous) / previous >= URGENT_GROWTH_RATIO : current > 0;
  if (!grew) return [];
  const pct = previous > 0 ? `${Math.round(((current - previous) / previous) * 100)}%` : "mới xuất hiện";
  return [clamp(`Tin KHẨN tăng mạnh: ${current} kỳ này so ${previous} kỳ trước (▲ ${pct})`)];
}

function slowResponseGroupAnomalies(data: PeriodicReportData): string[] {
  const overall = data.totals.responseAverageMinutes.current;
  if (overall <= 0) return [];
  return data.groups
    .filter((group) => group.responseAverageMinutes >= overall * RESPONSE_OUTLIER_FACTOR)
    .sort((a, b) => b.responseAverageMinutes - a.responseAverageMinutes)
    .map((group) => clamp(`Nhóm «${group.groupName}» phản hồi chậm: TB ${group.responseAverageMinutes} phút (chung ${overall} phút)`));
}

function silentGroupAnomalies(data: PeriodicReportData): string[] {
  return data.groups
    .filter((group) => group.previousMessages > 0 && group.messages === 0)
    .map((group) => clamp(`Nhóm «${group.groupName}» im lặng hẳn kỳ này (kỳ trước ${group.previousMessages} tin)`));
}

function tasksOverdueAnomaly(data: PeriodicReportData): string[] {
  const { current } = data.totals.tasksOverdueOpen;
  return current >= TASKS_OVERDUE_THRESHOLD ? [clamp(`Việc quá hạn còn mở: ${current} việc`)] : [];
}

function waitingOverdueAnomaly(data: PeriodicReportData): string[] {
  const { current } = data.totals.waitingOverdueOpen;
  return current > 0 ? [clamp(`Tin chờ trả lời quá giờ còn mở cuối kỳ: ${current} tin`)] : [];
}

/** Tối đa 5 ý bất thường, ưu tiên theo mức nghiêm trọng — xem ghi chú đầu tệp. */
export function detectAnomalies(data: PeriodicReportData): string[] {
  return [
    ...urgentGrowthAnomaly(data),
    ...slowResponseGroupAnomalies(data),
    ...silentGroupAnomalies(data),
    ...tasksOverdueAnomaly(data),
    ...waitingOverdueAnomaly(data),
  ].slice(0, MAX_ANOMALIES);
}
