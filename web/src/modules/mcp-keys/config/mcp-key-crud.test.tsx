import { describe, expect, it } from 'vitest'

import { MCP_KEY_COLUMNS, mcpKeyCrudConfig } from './mcp-key-crud'

// Khóa sắp xếp của máy chủ (`sorts` của MCP_KEY_LIST_SPEC) — chép tay; cột khai khác danh sách này thì bấm tiêu đề không có tác dụng
const SERVER_SORT_KEYS = ['created_at', 'last_used_at', 'name']

describe('mcpKeyCrudConfig', () => {
  it('only marks columns sortable that the server can sort by', () => {
    const sortable = MCP_KEY_COLUMNS.filter((column) => column.sortable).map((column) => column.key)
    expect(sortable.length).toBeGreaterThan(0)
    for (const key of sortable) expect(SERVER_SORT_KEYS).toContain(key)
  })

  it('creates keys through the dedicated dialog and keeps the detail page read-only', () => {
    expect(mcpKeyCrudConfig.FormDialog).toBeDefined()
    expect(mcpKeyCrudConfig.createRoute).toBeUndefined()
    expect(mcpKeyCrudConfig.readOnlyDetail).toBe(true)
  })

  it('lists the columns the screen promises: name, prefix, level, secret flag, expiry, last use, status, owner', () => {
    expect(MCP_KEY_COLUMNS.map((column) => column.key)).toEqual(
      expect.arrayContaining(['name', 'prefix', 'access_level', 'include_confidential', 'expires_at', 'last_used_at', 'status', 'owner_name']),
    )
  })
})
