export const METRIC_TABS = [
  { key: 'summary', label: 'Tổng hợp' },
  { key: 'details', label: 'Chi tiết' },
  { key: 'missing', label: 'Chưa báo' },
] as const

export type MetricTabKey = (typeof METRIC_TABS)[number]['key']

/** Giá trị `?tab=` lạ hoặc thiếu thì về tab "Tổng hợp". */
export function resolveMetricTab(raw: string | null): MetricTabKey {
  return METRIC_TABS.find((tab) => tab.key === raw)?.key ?? 'summary'
}
