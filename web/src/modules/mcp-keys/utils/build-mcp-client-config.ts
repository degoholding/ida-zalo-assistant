/** Tên máy chủ trong cấu hình client — ngắn, không dấu để dùng được làm khóa TOML / lệnh shell. */
export const MCP_SERVER_NAME = 'ida-bot'
/** Biến môi trường chứa khóa ở mẫu Codex (Codex đọc khóa từ biến, không ghi thẳng vào config.toml). */
export const CODEX_KEY_ENV_VAR = 'IDA_MCP_KEY'

export interface McpClientConfigSnippets {
  url: string
  claudeCode: string
  codex: string
  /** JSON `mcpServers` dùng được cho Claude Desktop / Cursor / client đọc chuẩn này. */
  genericJson: string
  /** Lệnh kiểm nhanh khóa bằng HTTP thuần. */
  curlCheck: string
}

/** Địa chỉ cổng MCP của máy chủ đang phục vụ giao diện: `<origin>/mcp` (bỏ dấu `/` thừa ở origin). */
export function buildMcpUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/mcp`
}

/** Dựng mẫu cấu hình client từ origin hiện tại + khóa thô. Thuần — không đọc `window`, để test được. */
export function buildMcpClientConfig(origin: string, token: string): McpClientConfigSnippets {
  const url = buildMcpUrl(origin)
  return {
    url,
    claudeCode: `claude mcp add --transport http ${MCP_SERVER_NAME} ${url} --header "Authorization: Bearer ${token}"`,
    codex: [
      `# Chạy một lần trong shell (hoặc đặt vào ~/.zshrc)`,
      `export ${CODEX_KEY_ENV_VAR}="${token}"`,
      ``,
      `# ~/.codex/config.toml`,
      `[mcp_servers.${MCP_SERVER_NAME}]`,
      `url = "${url}"`,
      `bearer_token_env_var = "${CODEX_KEY_ENV_VAR}"`,
    ].join('\n'),
    genericJson: JSON.stringify(
      { mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } },
      null,
      2,
    ),
    curlCheck: [
      `curl -s ${url} \\`,
      `  -H "Authorization: Bearer ${token}" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "Accept: application/json, text/event-stream" \\`,
      `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    ].join('\n'),
  }
}
