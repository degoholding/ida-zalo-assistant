import { describe, expect, it } from 'vitest'

import { SHARED_LINKS_API_PATH } from '../api/file-api'
import { SHARED_LINK_KIND_OPTIONS } from '../types/shared-link'
import { sharedLinkCrudConfig } from './shared-link-crud'

/** Hợp đồng với `SHARED_LINK_LIST_SPEC` ở `src/web/api/shared-links-api.ts` — chép tay; trường không khai bên máy chủ thì bị bỏ qua im lặng. */
const SERVER_SORTS = ['sent_at', 'host', 'kind']
const SERVER_FILTER_FIELDS = ['group_id', 'thread_type', 'kind', 'host', 'url', 'title', 'sender_uid', 'sender_name', 'sent_at']

describe('sharedLinkCrudConfig — contract with the server list spec', () => {
  it('only marks columns sortable that the server can sort by', () => {
    const sortable = sharedLinkCrudConfig.columns.filter((column) => column.sortable).map((column) => column.key)
    expect(sortable.length).toBeGreaterThan(0)
    for (const key of sortable) expect(SERVER_SORTS).toContain(key)
  })
  it('only sends filter params the server whitelists, and keeps the tab param when filters are applied', () => {
    for (const field of sharedLinkCrudConfig.filterConfig?.fields ?? []) expect(SERVER_FILTER_FIELDS).toContain(field.name)
    for (const quick of sharedLinkCrudConfig.quickFilters ?? []) expect(SERVER_FILTER_FIELDS).toContain(quick.key)
    expect(sharedLinkCrudConfig.filterConfig?.preserveParams).toContain('tab')
  })
  it('reads /api/files/links under the file permission, newest first, no create form', () => {
    expect(sharedLinkCrudConfig.apiPath).toBe(SHARED_LINKS_API_PATH)
    expect(SHARED_LINKS_API_PATH).toBe('/api/files/links')
    expect(sharedLinkCrudConfig.entity).toBe('file')
    expect(sharedLinkCrudConfig.defaultSort).toEqual({ by: 'sent_at', dir: 'desc' })
    expect(sharedLinkCrudConfig.formFields).toEqual([])
  })
  it('offers the six server link kinds (SharedLinkKind) as the kind quick filter', () => {
    expect(SHARED_LINK_KIND_OPTIONS.map((option) => option.value).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 9])
    const kind = sharedLinkCrudConfig.quickFilters?.find((quick) => quick.key === 'kind')
    expect(kind?.options).toHaveLength(6)
  })
})
