import type { MetricMapping } from '../types/metric'

// Khớp luật `validateMapping` ở máy chủ (src/metrics/metric-mapping.ts): kiểm sớm để người khai thấy lỗi ngay trên form.
// Máy chủ vẫn là chốt chặn thật.

const CODE_PATTERN = /^[a-z0-9_]{2,40}$/
export const MAX_METRICS = 20

/** Trả câu lỗi tiếng Việt, hoặc `null` khi ánh xạ hợp lệ. */
export function validateMetricMapping(mapping: Partial<MetricMapping> | null | undefined): string | null {
  if (!mapping) return 'Chưa có ánh xạ cột.'
  if (!mapping.date?.trim()) return 'Thiếu cột «Ngày».'
  if (!mapping.staff?.trim()) return 'Thiếu cột «Nhân viên».'
  if (mapping.staff_by && mapping.staff_by !== 'name' && mapping.staff_by !== 'code') return 'Nhân viên nhận theo «tên» hoặc «mã».'
  const metrics = mapping.metrics ?? []
  if (metrics.length < 1 || metrics.length > MAX_METRICS) return `Cần từ 1 đến ${MAX_METRICS} chỉ tiêu.`
  const seen = new Set<string>()
  for (const [index, metric] of metrics.entries()) {
    const where = `Chỉ tiêu thứ ${index + 1}`
    const code = (metric.code ?? '').trim()
    if (!CODE_PATTERN.test(code)) return `${where}: mã gồm 2–40 ký tự a–z, 0–9, gạch dưới.`
    if (seen.has(code)) return `${where}: mã «${code}» bị trùng.`
    if (!(metric.column ?? '').trim()) return `${where} («${code}») thiếu cột.`
    seen.add(code)
  }
  return null
}

export function createEmptyMapping(): MetricMapping {
  return { date: '', staff: '', staff_by: 'name', area: '', metrics: [{ code: '', label: '', column: '', unit: '', aggregate: 'sum' }] }
}
