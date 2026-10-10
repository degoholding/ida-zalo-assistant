import { describe, expect, it } from 'vitest'

import { briefCrudConfig } from './brief-crud'

/**
 * Hợp đồng với `BRIEF_LIST_SPEC` của `src/web/api/briefs-api.ts` — chép tay. Tên lọc / sắp xếp không khai bên máy
 * chủ thì `runList` BỎ QUA IM LẶNG: bấm tiêu đề không đổi thứ tự, chọn lọc không thu hẹp gì, mà không ai báo lỗi.
 */
const SERVER_SORTS = ['created_at', 'sent_at']
const SERVER_FILTER_FIELDS = ['recipient_id', 'kind', 'trigger_source', 'status', 'created_at']

describe('briefCrudConfig — contract with the server list spec', () => {
  it('only marks columns sortable that the server can sort by', () => {
    const sortable = briefCrudConfig.columns.filter((column) => column.sortable).map((column) => column.key)
    expect(sortable.length).toBeGreaterThan(0)
    for (const key of sortable) expect(SERVER_SORTS).toContain(key)
  })

  it('only sends filter and quick-filter params the server whitelists', () => {
    for (const field of briefCrudConfig.filterConfig?.fields ?? []) expect(SERVER_FILTER_FIELDS).toContain(field.name)
    for (const quick of briefCrudConfig.quickFilters ?? []) expect(SERVER_FILTER_FIELDS).toContain(quick.key)
  })

  it('sends the kind / trigger_source / status quick filters as the numeric codes the server compares against', () => {
    const kind = briefCrudConfig.quickFilters?.find((quick) => quick.key === 'kind')
    expect(kind?.options?.map((option) => String(option.value))).toEqual(['1', '2', '3', '4'])
    const trigger = briefCrudConfig.quickFilters?.find((quick) => quick.key === 'trigger_source')
    expect(trigger?.options?.map((option) => String(option.value))).toEqual(['1', '2', '3'])
    const status = briefCrudConfig.quickFilters?.find((quick) => quick.key === 'status')
    expect(status?.options?.map((option) => String(option.value))).toEqual(['1', '2', '3', '4'])
  })

  it('searches with the q param and sorts newest-composed first by default', () => {
    expect(briefCrudConfig.searchParam).toBe('q')
    expect(briefCrudConfig.defaultSort).toEqual({ by: 'created_at', dir: 'desc' })
  })

  it('is a read-only detail without form fields — bot composes / sends briefs, the web screen only views them', () => {
    expect(briefCrudConfig.readOnlyDetail).toBe(true)
    expect(briefCrudConfig.formFields).toEqual([])
    expect(briefCrudConfig.detailActions).toBeUndefined()
  })

  it('uses the brief permission entity and the briefs routes', () => {
    expect(briefCrudConfig.entity).toBe('brief')
    expect(briefCrudConfig.apiPath).toBe('/api/briefs')
    expect(briefCrudConfig.detailRoute?.(12)).toBe('/briefs/12')
  })
})
