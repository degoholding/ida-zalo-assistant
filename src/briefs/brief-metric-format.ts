// Chữ số liệu dùng chung cho bản tin (brief-metric-section.ts) và báo cáo tuần / tháng (src/reports/periodic-report-metric-*.ts).
// Hàm THUẦN: số kiểu Việt (3.420 · 125,4), mũi tên ▲▼ theo % đổi so kỳ trước.

const numberFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

/** «3.420 bao» / «125,4 tr» — đơn vị rỗng thì chỉ số. */
export function formatMetricValue(value: number, unit: string): string {
  const text = numberFormat.format(value);
  return unit.trim() ? `${text} ${unit.trim()}` : text;
}

/** «▲12%» / «▼5%» / «không đổi»; không có kỳ trước (null) → rỗng. */
export function formatMetricChange(changePct: number | null): string {
  if (changePct === null) return "";
  if (changePct === 0) return "không đổi";
  return `${changePct > 0 ? "▲" : "▼"}${numberFormat.format(Math.abs(changePct))}%`;
}

/** «Doanh số: 125,4 tr (▲12% so hôm trước)» — `comparedTo` (vd «so hôm trước») chỉ gắn khi có mũi tên. */
export function metricSummary(label: string, value: number, unit: string, changePct: number | null, comparedTo = ""): string {
  const change = formatMetricChange(changePct);
  const suffix = change && change !== "không đổi" && comparedTo ? ` ${comparedTo}` : "";
  return `${label}: ${formatMetricValue(value, unit)}${change ? ` (${change}${suffix})` : ""}`;
}
