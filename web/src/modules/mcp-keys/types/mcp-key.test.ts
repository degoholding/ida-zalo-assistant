import { describe, expect, it } from 'vitest'

import { MCP_ACCESS_LEVEL, MCP_CALL_SOURCE, MCP_CALL_STATUS } from './mcp-key'

describe('mcp key code mapping', () => {
  it('mirrors the server enums in src/constants.ts', () => {
    // Chép tay — lệch một số là khóa «chỉ đọc» hiện thành «đọc + ghi»
    expect(MCP_ACCESS_LEVEL).toEqual({ read: 1, readWrite: 2 })
    expect(MCP_CALL_STATUS).toEqual({ ok: 0, denied: 1, invalid: 2, error: 3, rateLimited: 4 })
    expect(MCP_CALL_SOURCE).toEqual({ http: 1, assistant: 2, assistantCommand: 3 })
  })
})
