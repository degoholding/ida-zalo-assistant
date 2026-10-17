import { describe, expect, it } from 'vitest'

import { buildMcpClientConfig, buildMcpUrl } from './build-mcp-client-config'

const TOKEN = 'idamcp_ab12cd34_secretsecretsecret'

describe('buildMcpClientConfig', () => {
  it('points every snippet at <origin>/mcp and embeds the key', () => {
    const snippets = buildMcpClientConfig('https://botida.degoholding.vn', TOKEN)
    expect(snippets.url).toBe('https://botida.degoholding.vn/mcp')
    expect(snippets.claudeCode).toBe(
      `claude mcp add --transport http ida-bot https://botida.degoholding.vn/mcp --header "Authorization: Bearer ${TOKEN}"`,
    )
    expect(snippets.codex).toContain('url = "https://botida.degoholding.vn/mcp"')
    expect(snippets.codex).toContain(`export IDA_MCP_KEY="${TOKEN}"`)
    expect(snippets.curlCheck).toContain('https://botida.degoholding.vn/mcp')
  })

  it('generic JSON is valid JSON with the bearer header', () => {
    const parsed = JSON.parse(buildMcpClientConfig('http://127.0.0.1:8090', TOKEN).genericJson)
    expect(parsed.mcpServers['ida-bot']).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:8090/mcp',
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
  })

  it('does not double the slash when the origin ends with one', () => {
    expect(buildMcpUrl('https://x.vn/')).toBe('https://x.vn/mcp')
  })
})
