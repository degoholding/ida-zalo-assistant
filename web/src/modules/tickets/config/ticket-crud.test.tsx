import { describe, expect, it } from 'vitest'

import { ticketCrudConfig } from './ticket-crud'

/**
 * Hợp đồng với `TICKET_LIST_SPEC` của `src/web/api/tickets-api.ts` — chép tay. Tên lọc / sắp xếp không khai bên máy
 * chủ thì `runList` BỎ QUA IM LẶNG: bấm tiêu đề không đổi thứ tự, chọn lọc không thu hẹp gì, mà không ai báo lỗi.
 */
const SERVER_SORTS = ['created_at', 'status', 'code', 'updated_at']
const SERVER_FILTER_FIELDS = ['status', 'requester_name', 'handler_name', 'created_at']

describe('ticketCrudConfig — contract with the server list spec', () => {
  it('only marks columns sortable that the server can sort by', () => {
    const sortable = ticketCrudConfig.columns.filter((column) => column.sortable).map((column) => column.key)
    expect(sortable.length).toBeGreaterThan(0)
    for (const key of sortable) expect(SERVER_SORTS).toContain(key)
  })

  it('only sends filter and quick-filter params the server whitelists', () => {
    for (const field of ticketCrudConfig.filterConfig?.fields ?? []) expect(SERVER_FILTER_FIELDS).toContain(field.name)
    for (const quick of ticketCrudConfig.quickFilters ?? []) expect(SERVER_FILTER_FIELDS).toContain(quick.key)
  })

  it('sends the status quick filter as the numeric code the server compares against', () => {
    const status = ticketCrudConfig.quickFilters?.find((quick) => quick.key === 'status')
    expect(status?.options?.map((option) => String(option.value))).toEqual(['1', '2', '3', '4'])
  })

  it('searches with the q param and lists newest tickets first by default', () => {
    expect(ticketCrudConfig.searchParam).toBe('q')
    expect(ticketCrudConfig.defaultSort).toEqual({ by: 'created_at', dir: 'desc' })
  })

  it('is a read-only detail without form fields — the server has no PATCH for tickets', () => {
    expect(ticketCrudConfig.readOnlyDetail).toBe(true)
    expect(ticketCrudConfig.formFields).toEqual([])
  })

  it('uses the ticket permission entity and the ticket routes', () => {
    expect(ticketCrudConfig.entity).toBe('ticket')
    expect(ticketCrudConfig.apiPath).toBe('/api/tickets')
    expect(ticketCrudConfig.detailRoute?.(12)).toBe('/tickets/12')
  })
})
