import { describe, expect, it } from 'vitest'

import type { ImportSummary } from '../types/import'
import { mergeImportSummaries } from './merge-import-summaries'

const makeSummary = (overrides: Partial<ImportSummary>): ImportSummary => ({
  total: 0, imported: 0, duplicates: 0, enriched: 0, skipped_direct: 0, skipped_unknown_group: 0, skipped_group_not_read: 0,
  oldest: null, newest: null, groups: [], ...overrides,
})

describe('mergeImportSummaries', () => {
  it('returns null when no file succeeded', () => {
    expect(mergeImportSummaries([])).toBeNull()
  })

  it('adds every counter across files', () => {
    const merged = mergeImportSummaries([
      makeSummary({ total: 10, imported: 7, duplicates: 2, enriched: 1, skipped_unknown_group: 3 }),
      makeSummary({ total: 5, imported: 5, skipped_direct: 4, skipped_group_not_read: 2 }),
    ])
    expect(merged).toMatchObject({ total: 15, imported: 12, duplicates: 2, enriched: 1, skipped_direct: 4, skipped_unknown_group: 3, skipped_group_not_read: 2 })
  })

  it('takes the widest time range and ignores files that imported nothing', () => {
    const merged = mergeImportSummaries([
      makeSummary({ oldest: '2026-09-20T01:00:00.000Z', newest: '2026-09-25T01:00:00.000Z' }),
      makeSummary({ oldest: null, newest: null }),
      makeSummary({ oldest: '2026-09-18T01:00:00.000Z', newest: '2026-10-01T01:00:00.000Z' }),
    ])
    expect(merged?.oldest).toBe('2026-09-18T01:00:00.000Z')
    expect(merged?.newest).toBe('2026-10-01T01:00:00.000Z')
  })

  it('sums the same group exported twice instead of listing it twice', () => {
    const merged = mergeImportSummaries([
      makeSummary({ groups: [{ zalo_group_id: '1', name: 'K52', imported: 3 }] }),
      makeSummary({ groups: [{ zalo_group_id: '1', name: 'K52', imported: 2 }, { zalo_group_id: '2', name: 'Kho', imported: 0 }] }),
    ])
    expect(merged?.groups).toEqual([{ zalo_group_id: '1', name: 'K52', imported: 5 }, { zalo_group_id: '2', name: 'Kho', imported: 0 }])
  })

  it('does not mutate the first summary', () => {
    const first = makeSummary({ imported: 1, groups: [{ zalo_group_id: '1', name: 'K52', imported: 1 }] })
    mergeImportSummaries([first, makeSummary({ imported: 2, groups: [{ zalo_group_id: '1', name: 'K52', imported: 2 }] })])
    expect(first.imported).toBe(1)
    expect(first.groups[0].imported).toBe(1)
  })
})
