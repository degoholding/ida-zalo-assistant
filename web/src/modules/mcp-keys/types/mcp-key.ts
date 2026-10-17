/** Mức quyền của khóa MCP — khớp `McpAccessLevel` ở `src/constants.ts`; đổi bên đó thì sửa tay bên này. */
export const MCP_ACCESS_LEVEL = { read: 1, readWrite: 2 } as const

/** Kết quả một lời gọi công cụ — khớp `McpCallStatus` ở `src/constants.ts`. */
export const MCP_CALL_STATUS = { ok: 0, denied: 1, invalid: 2, error: 3, rateLimited: 4 } as const

/** Cổng gọi — khớp `McpCallSource` ở `src/constants.ts`. */
export const MCP_CALL_SOURCE = { http: 1, assistant: 2 } as const
