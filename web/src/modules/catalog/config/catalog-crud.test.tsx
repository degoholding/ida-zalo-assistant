import { describe, expect, it } from 'vitest'

import { CATALOG_KIND, CATALOG_MATCH_STATUS, CATALOG_MATCH_STATUS_OPTIONS } from '../types/catalog'
import { catalogCrudConfig } from './catalog-crud'

/** Hợp đồng với `CATALOG_LIST_SPEC` của `src/web/api/catalog-api.ts` — chép tay (trường không khai thì máy chủ bỏ qua im lặng). */
const SERVER_SORTS = ['code', 'name', 'kind', 'region', 'sales_zone', 'match_status', 'owner_name', 'updated_at']
const SERVER_FILTER_FIELDS = ['kind', 'region', 'sales_zone', 'match_status', 'is_active', 'owner_entry_id']

describe('catalogCrudConfig — contract with the server list spec', () => {
  it('only marks columns sortable that the server can sort by', () => {
    const sortable = catalogCrudConfig.columns.filter((column) => column.sortable).map((column) => column.key)
    expect(sortable.length).toBeGreaterThan(0)
    for (const key of sortable) expect(SERVER_SORTS).toContain(key)
    expect(SERVER_SORTS).toContain(catalogCrudConfig.defaultSort?.by)
  })

  it('only sends filter and quick-filter params the server whitelists', () => {
    for (const field of catalogCrudConfig.filterConfig?.fields ?? []) expect(SERVER_FILTER_FIELDS).toContain(field.name)
    for (const quick of catalogCrudConfig.quickFilters ?? []) expect(SERVER_FILTER_FIELDS).toContain(quick.key)
  })

  it('copies the numeric codes of CatalogKind / CatalogMatchStatus from src/constants.ts', () => {
    expect(CATALOG_KIND).toEqual({ staff: 1, dealer: 2 })
    expect(CATALOG_MATCH_STATUS_OPTIONS.map((option) => option.value)).toEqual([0, 1, 2, 3, 4])
    expect(CATALOG_MATCH_STATUS.confirmed).toBe(3)
    expect(CATALOG_MATCH_STATUS.unlinked).toBe(4)
  })

  it('is a read-only detail: data comes from the Excel file, the web only confirms / unlinks matches', () => {
    expect(catalogCrudConfig.readOnlyDetail).toBe(true)
    expect(catalogCrudConfig.formFields).toEqual([])
    expect(catalogCrudConfig.searchParam).toBe('q')
  })
})
