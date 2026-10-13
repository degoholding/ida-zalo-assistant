import type { Db } from "../db/pool.js";
import { aggregateMetrics, listMetricCatalog } from "../metrics/metric-query-service.js";
import { listMissingReporters } from "../metrics/metric-missing-reporters.js";
import { vnMidnight } from "../schedule/work-calendar.js";
import { clock, dayLabel, BRIEF_SECTION_LIMIT } from "./brief-format.js";
import { metricSummary } from "./brief-metric-format.js";

// Mục «6. Số liệu» của bản tin sáng / cuối ngày (phase 5 của Phase 10). KHÔNG qua AI; số không theo phạm vi nhóm nên mọi
// người nhận thấy cùng một mục (chốt 12/10/2026). Không có nguồn bật / kỳ không có dòng → `null` → bản tin ẩn hẳn mục này.

export interface BriefMetricLine {
  label: string;
  unit: string;
  total: number;
  /** % so ngày làm việc trước (`compareDate`), null = không so / không có số để so */
  changePct: number | null;
}

export interface BriefMetricDigest {
  /** Ngày số liệu «YYYY-MM-DD» — tiêu đề bản tin sáng ghi đúng ngày này (sáng T2 có thể là số T7, không phải «hôm qua») */
  date: string;
  /** Ngày đem ra so (% / mũi tên); null = không so (bản cuối ngày: số mới tới 17:30, so cả ngày trước là lệch) */
  compareDate: string | null;
  /** Chỉ tiêu CÓ số trong ngày, theo thứ tự khai trong ánh xạ */
  metrics: BriefMetricLine[];
  /** Tên các nguồn có số (không lộ link bảng) */
  sourceNames: string[];
  /** Lần đọc thành công gần nhất của các nguồn đó */
  readAt: Date | null;
  /** Số NV có dòng bị gắn cờ (âm / lệch / không đọc được / lạ) */
  flaggedCount: number;
  /** Số NV chưa báo; null = chưa kết luận được (chưa 18:00 / không có nguồn «báo hằng ngày» / bản tin cuối ngày) */
  missingCount: number | null;
}

export interface CollectBriefMetricsOptions {
  /** Ngày số liệu «YYYY-MM-DD» (sáng = ngày làm việc trước, cuối ngày = hôm nay) */
  date: string;
  /** Chỉ bản tin sáng: có đếm «chưa báo» hay không (cuối ngày 17:30 chạy trước mốc 18:00) */
  withMissing: boolean;
  /** Ngày so sánh (sáng = ngày làm việc liền trước `date`); null = không so — bản cuối ngày chỉ in số tuyệt đối + cờ */
  compareDate: string | null;
}

/** `null` khi chưa có nguồn / không có số. Mọi lỗi truy vấn do nơi gọi bắt (bản tin vẫn gửi, bỏ mục). */
export async function collectBriefMetrics(db: Db, options: CollectBriefMetricsOptions, now: Date): Promise<BriefMetricDigest | null> {
  const catalog = await listMetricCatalog(db);
  const codes = [...new Set(catalog.map((item) => item.code))];
  if (codes.length === 0) return null;
  const query = { codes, from: options.date, to: options.date };
  const compare = options.compareDate ? { from: options.compareDate, to: options.compareDate } : null;
  const [byMetric, byStaff] = await Promise.all([
    aggregateMetrics(db, { ...query, groupBy: "metric", compare }),
    // Theo NV chỉ để đếm cờ — không cần kỳ trước
    aggregateMetrics(db, { ...query, groupBy: "staff", compare: null }),
  ]);
  const rowOf = new Map(byMetric.rows.map((row) => [row.key, row]));
  const metrics: BriefMetricLine[] = [];
  const usedCodes = new Set<string>();
  for (const code of codes) {
    const row = rowOf.get(code);
    const item = catalog.find((entry) => entry.code === code);
    if (!row || !item) continue;
    metrics.push({ label: item.label, unit: item.unit, total: row.value, changePct: row.changePct });
    usedCodes.add(code);
  }
  if (metrics.length === 0) return null;
  const used = catalog.filter((item) => usedCodes.has(item.code));
  const reads = used.map((item) => item.lastOkAt).filter((at): at is Date => at !== null);
  const missing = options.withMissing ? await listMissingReporters(db, options.date, now) : null;
  return {
    date: options.date,
    compareDate: compare ? options.compareDate : null,
    metrics,
    sourceNames: [...new Set(used.map((item) => item.sourceName))],
    readAt: reads.length ? new Date(Math.max(...reads.map((at) => at.getTime()))) : null,
    flaggedCount: byStaff.rows.filter((row) => row.flagged).length,
    missingCount: missing?.ready ? missing.missing.length : null,
  };
}

export interface MetricSectionTitle {
  /** «6. Số liệu T7 10/10» (sáng) · «6. Số liệu hôm nay» (cuối ngày) */
  title: string;
  /** true = «(tới HH:MM)» (cuối ngày); false = «(Nguồn, đọc HH:MM)» (sáng) */
  untilOnly: boolean;
}

function headline(digest: BriefMetricDigest, { title, untilOnly }: MetricSectionTitle): string {
  const read = digest.readAt ? clock(digest.readAt) : "";
  if (untilOnly) return read ? `${title} (tới ${read})` : title;
  const parts = [digest.sourceNames.join(", "), read ? `đọc ${read}` : ""].filter(Boolean);
  return parts.length ? `${title} (${parts.join(", ")})` : title;
}

/** «T7 10/10» của một ngày «YYYY-MM-DD». */
export const metricDayLabel = (iso: string) => dayLabel(vnMidnight(iso));

/** Mục số liệu: tiêu đề + ≤ 3 dòng (dòng cờ / chưa báo chiếm một dòng nếu có) + «… và N nữa». */
export function formatMetricSection(digest: BriefMetricDigest, title: MetricSectionTitle): string[] {
  const status = [
    digest.flaggedCount > 0 ? `${digest.flaggedCount} số cần xác nhận` : "",
    digest.missingCount ? `${digest.missingCount} NV chưa báo` : "",
  ].filter(Boolean).join(" · ");
  const room = BRIEF_SECTION_LIMIT - (status ? 1 : 0);
  const shown = digest.metrics.slice(0, room);
  const more = digest.metrics.length - shown.length;
  // Không so (cuối ngày) → bỏ hẳn % / mũi tên; có so → nhãn ngày so ở dòng đầu («so T6 09/10»)
  const comparedTo = digest.compareDate ? `so ${metricDayLabel(digest.compareDate)}` : "";
  return [
    headline(digest, title),
    ...shown.map((metric, index) =>
      `   - ${metricSummary(metric.label, metric.total, metric.unit, digest.compareDate ? metric.changePct : null, index === 0 ? comparedTo : "")}`),
    ...(more > 0 ? [`   … và ${more} nữa`] : []),
    ...(status ? [`   - ${status}`] : []),
  ];
}
