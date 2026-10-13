import type { MetricMapping } from '../types/metric'

// Đối chiếu ánh xạ đang gõ với tiêu đề bảng đọc thử được — cho dấu ✓ / ✗ cạnh từng cột. Khớp luật `findColumn` ở máy chủ:
// tiêu đề (so gấp dấu, bỏ khoảng trắng thừa) trước, không có thì hiểu là chữ cột A…ZZ.

export interface MappingColumnCheck {
  role: string
  spec: string
  found: boolean
}

export function foldHeaderText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function letterToIndex(spec: string): number {
  if (!/^[A-Za-z]{1,2}$/.test(spec)) return -1
  const index = [...spec.toUpperCase()].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1
  return index <= 26 * 27 - 1 ? index : -1
}

/** `headers` rỗng (chưa đọc được) thì mọi cột đều chưa khớp. */
export function isColumnFound(spec: string, headers: string[]): boolean {
  const wanted = foldHeaderText(spec)
  if (!wanted) return false
  if (headers.some((header) => foldHeaderText(header) === wanted)) return true
  return letterToIndex(spec.trim()) >= 0
}

export function checkMappingColumns(mapping: MetricMapping, headers: string[]): MappingColumnCheck[] {
  const checks: MappingColumnCheck[] = [
    { role: 'Ngày', spec: mapping.date, found: isColumnFound(mapping.date, headers) },
    { role: 'Nhân viên', spec: mapping.staff, found: isColumnFound(mapping.staff, headers) },
  ]
  if (mapping.area.trim()) checks.push({ role: 'Khu vực', spec: mapping.area, found: isColumnFound(mapping.area, headers) })
  for (const metric of mapping.metrics) {
    checks.push({ role: metric.label || metric.code, spec: metric.column, found: isColumnFound(metric.column, headers) })
  }
  return checks
}
