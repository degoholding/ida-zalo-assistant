import { describe, expect, it } from 'vitest'

import { sendCommandCrudConfig } from './send-command-crud'

/**
 * Hợp đồng với `SEND_COMMAND_LIST_SPEC` của `src/web/api/send-commands-api.ts` — chép tay. Tên lọc / sắp xếp không khai
 * bên máy chủ thì `runList` BỎ QUA IM LẶNG: bấm tiêu đề không đổi thứ tự, chọn lọc không thu hẹp gì.
 */
const SERVER_SORTS = ['created_at', 'scheduled_at', 'action_kind', 'reminder_at']
const SERVER_FILTER_FIELDS = ['status', 'source', 'action_kind', 'requester_uid', 'created_at', 'scheduled_at', 'reminder_at']

describe('sendCommandCrudConfig — contract with the server list spec', () => {
  it('only marks columns sortable that the server can sort by', () => {
    const sortable = sendCommandCrudConfig.columns.filter((column) => column.sortable).map((column) => column.key)
    expect(sortable.length).toBeGreaterThan(0)
    for (const key of sortable) expect(SERVER_SORTS).toContain(key)
  })

  it('only sends filter and quick-filter params the server whitelists', () => {
    for (const field of sendCommandCrudConfig.filterConfig?.fields ?? []) expect(SERVER_FILTER_FIELDS).toContain(field.name)
    for (const quick of sendCommandCrudConfig.quickFilters ?? []) expect(SERVER_FILTER_FIELDS).toContain(quick.key)
  })

  it('sends status quick filter as the six numeric codes the server compares against', () => {
    const status = sendCommandCrudConfig.quickFilters?.find((quick) => quick.key === 'status')
    expect(status?.options?.map((option) => String(option.value))).toEqual(['1', '2', '3', '4', '5', '6'])
    const source = sendCommandCrudConfig.quickFilters?.find((quick) => quick.key === 'source')
    expect(source?.options?.map((option) => String(option.value))).toEqual(['1', '2'])
    const kind = sendCommandCrudConfig.quickFilters?.find((quick) => quick.key === 'action_kind')
    expect(kind?.options?.map((option) => String(option.value))).toEqual(['1', '2', '3'])
  })

  it('searches with the q param and sorts newest first by default', () => {
    expect(sendCommandCrudConfig.searchParam).toBe('q')
    expect(sendCommandCrudConfig.defaultSort).toEqual({ by: 'created_at', dir: 'desc' })
  })

  it('is a read-only detail without a compose form — commands come from Zalo, the web only views / cancels / resends', () => {
    expect(sendCommandCrudConfig.readOnlyDetail).toBe(true)
    expect(sendCommandCrudConfig.formFields).toEqual([])
    expect(sendCommandCrudConfig.detailActions).toBeDefined()
  })

  it('uses the send_command permission entity and routes', () => {
    expect(sendCommandCrudConfig.entity).toBe('send_command')
    expect(sendCommandCrudConfig.apiPath).toBe('/api/send-commands')
    expect(sendCommandCrudConfig.detailRoute?.(12)).toBe('/send-commands/12')
  })
})
