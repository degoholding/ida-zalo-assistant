import { describe, expect, it } from 'vitest'

import { metricSourceCrudConfig } from './metric-source-crud'
import { METRIC_SOURCE_CREATE_ROUTE } from './metric-source-routes'

/** Hợp đồng với `METRIC_SOURCE_LIST_SPEC` ở `src/web/api/metric-sources-api.ts`. */
const SERVER_SORTS = ['name', 'status', 'last_ok_at', 'last_sync_at', 'created_at']
const SERVER_FILTER_FIELDS = ['name', 'status', 'is_active', 'daily_report']

describe('metricSourceCrudConfig — contract with the server list spec', () => {
  it('only marks columns sortable that the server can sort by', () => {
    const sortable = metricSourceCrudConfig.columns.filter((column) => column.sortable).map((column) => column.key)
    for (const key of sortable) expect(SERVER_SORTS).toContain(key)
  })
  it('only sends quick filters the server whitelists', () => {
    for (const quick of metricSourceCrudConfig.quickFilters ?? []) expect(SERVER_FILTER_FIELDS).toContain(quick.key)
  })
  it('form fields cover everything the API accepts, and the mapping defaults to one empty metric row', () => {
    const names = (metricSourceCrudConfig.formFields as { name: string }[]).map((field) => field.name)
    expect(names).toEqual(['name', 'spreadsheet_url', 'sheet_title', 'header_row', 'daily_report', 'is_active', 'mapping'])
    const mapping = (metricSourceCrudConfig.formFields as { name: string; defaultValue?: { metrics: unknown[] } }[]).find((f) => f.name === 'mapping')
    expect(mapping?.defaultValue?.metrics).toHaveLength(1)
  })
  it('routes: detail under /metric-sources, create route is a static sibling wired into the CRUD «Thêm» button', () => {
    expect(metricSourceCrudConfig.detailRoute?.(7)).toBe('/metric-sources/7')
    expect(METRIC_SOURCE_CREATE_ROUTE).toBe('/metric-sources/new')
    expect(metricSourceCrudConfig.createRoute).toBe(METRIC_SOURCE_CREATE_ROUTE)
    expect(metricSourceCrudConfig.apiPath).toBe('/api/metric-sources')
  })
  it('history timeline reads the server audit entity `metric_source`, not the permission key', () => {
    expect(metricSourceCrudConfig.entity).toBe('metric')
    expect(metricSourceCrudConfig.auditEntity).toBe('metric_source')
  })
})
