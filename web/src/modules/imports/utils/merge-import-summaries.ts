import type { ImportSummary } from '../types/import'

const COUNT_FIELDS = ['total', 'imported', 'duplicates', 'enriched', 'skipped_direct', 'skipped_unknown_group', 'skipped_group_not_read'] as const

/**
 * Cộng kết quả nhiều tệp (mỗi nhóm một tệp) thành một bảng. Mốc thời gian là chuỗi ISO nên so chuỗi là
 * đúng thứ tự; nhóm trùng giữa các tệp (xuất lại cùng nhóm) thì cộng dồn số tin nhập mới.
 */
export function mergeImportSummaries(summaries: ImportSummary[]): ImportSummary | null {
  if (!summaries.length) return null
  const merged: ImportSummary = { ...summaries[0], groups: [] }
  for (const field of COUNT_FIELDS) merged[field] = summaries.reduce((sum, item) => sum + item[field], 0)
  const oldest = summaries.map((item) => item.oldest).filter((value): value is string => Boolean(value)).sort()
  const newest = summaries.map((item) => item.newest).filter((value): value is string => Boolean(value)).sort()
  merged.oldest = oldest[0] ?? null
  merged.newest = newest[newest.length - 1] ?? null
  const groups = new Map<string, ImportSummary['groups'][number]>()
  for (const group of summaries.flatMap((item) => item.groups)) {
    const existing = groups.get(group.zalo_group_id)
    groups.set(group.zalo_group_id, existing ? { ...existing, imported: existing.imported + group.imported } : { ...group })
  }
  merged.groups = [...groups.values()]
  return merged
}
