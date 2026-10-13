import { describe, expect, it } from 'vitest'

import { metricValueCrudConfig } from './metric-value-crud'

/** Hợp đồng với `METRIC_VALUE_LIST_SPEC` ở `src/web/api/metrics-api.ts` — chép tay; trường không khai bên máy chủ thì bị bỏ qua im lặng. */
const SERVER_SORTS = ['metric_date', 'value', 'staff_name', 'area_name', 'metric_code']
const SERVER_FILTER_FIELDS = ['metric_date', 'metric_code', 'area_key', 'catalog_entry_id', 'source_id', 'flags']

describe('metricValueCrudConfig — contract with the server list spec', () => {
  it('only marks columns sortable that the server can sort by', () => {
    const sortable = metricValueCrudConfig.columns.filter((column) => column.sortable).map((column) => column.key)
    expect(sortable.length).toBeGreaterThan(0)
    for (const key of sortable) expect(SERVER_SORTS).toContain(key)
  })
  it('only sends filter params the server whitelists, and keeps the tab param when filters are applied', () => {
    for (const field of metricValueCrudConfig.filterConfig?.fields ?? []) expect(SERVER_FILTER_FIELDS).toContain(field.name)
    for (const quick of metricValueCrudConfig.quickFilters ?? []) expect(SERVER_FILTER_FIELDS).toContain(quick.key)
    expect(metricValueCrudConfig.filterConfig?.preserveParams).toContain('tab')
  })
  it('offers the four flag bits as the flags quick filter', () => {
    const flags = metricValueCrudConfig.quickFilters?.find((quick) => quick.key === 'flags')
    expect(flags?.options?.map((option) => String(option.value))).toEqual(['1', '2', '4', '8'])
  })
  it('is read-only and sorted newest day first', () => {
    expect(metricValueCrudConfig.readOnlyDetail).toBe(true)
    expect(metricValueCrudConfig.defaultSort).toEqual({ by: 'metric_date', dir: 'desc' })
    expect(metricValueCrudConfig.entity).toBe('metric')
  })
})
