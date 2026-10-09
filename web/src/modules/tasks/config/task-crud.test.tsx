import { describe, expect, it } from 'vitest'

import { taskCrudConfig } from './task-crud'

/**
 * Hợp đồng với `TASK_LIST_SPEC` của `src/web/api/tasks-api.ts` — chép tay. Tên lọc / sắp xếp không khai bên máy
 * chủ thì `runList` BỎ QUA IM LẶNG: bấm tiêu đề không đổi thứ tự, chọn lọc không thu hẹp gì, mà không ai báo lỗi.
 */
const SERVER_SORTS = ['due_at', 'status', 'priority', 'code', 'created_at']
const SERVER_FILTER_FIELDS = [
  'status', 'priority', 'assignee_contact_id', 'source_thread_id', 'source', 'due_at', 'overdue', 'missing_assignee', 'missing_due',
]

describe('taskCrudConfig — contract with the server list spec', () => {
  it('only marks columns sortable that the server can sort by', () => {
    const sortable = taskCrudConfig.columns.filter((column) => column.sortable).map((column) => column.key)
    expect(sortable.length).toBeGreaterThan(0)
    for (const key of sortable) expect(SERVER_SORTS).toContain(key)
  })

  it('only sends filter and quick-filter params the server whitelists', () => {
    for (const field of taskCrudConfig.filterConfig?.fields ?? []) expect(SERVER_FILTER_FIELDS).toContain(field.name)
    for (const quick of taskCrudConfig.quickFilters ?? []) expect(SERVER_FILTER_FIELDS).toContain(quick.key)
  })

  it('sends the status quick filter as the numeric code the server compares against', () => {
    const status = taskCrudConfig.quickFilters?.find((quick) => quick.key === 'status')
    expect(status?.options?.map((option) => String(option.value))).toEqual(['1', '2', '3', '4'])
  })

  it('searches with the q param and sorts by nearest due date first by default', () => {
    expect(taskCrudConfig.searchParam).toBe('q')
    expect(taskCrudConfig.defaultSort).toEqual({ by: 'due_at', dir: 'asc' })
  })

  it('is a read-only detail without form fields — creation goes through the custom TaskCreateButton', () => {
    expect(taskCrudConfig.readOnlyDetail).toBe(true)
    expect(taskCrudConfig.formFields).toEqual([])
  })

  it('uses the task permission entity and the task routes', () => {
    expect(taskCrudConfig.entity).toBe('task')
    expect(taskCrudConfig.apiPath).toBe('/api/tasks')
    expect(taskCrudConfig.detailRoute?.(12)).toBe('/tasks/12')
  })
})
