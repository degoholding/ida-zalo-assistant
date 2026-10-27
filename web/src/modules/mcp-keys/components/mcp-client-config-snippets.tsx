import { CopyButton } from '@/shared/ui/copy-button'
import { buildMcpClientConfig } from '../utils/build-mcp-client-config'

function Snippet({ title, code, label }: { title: string; code: string; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <CopyButton value={code} label={label} />
      </div>
      <pre className="max-h-40 overflow-auto rounded-md border bg-muted/50 p-2.5 font-mono text-xs break-all whitespace-pre-wrap">{code}</pre>
    </div>
  )
}

/** Mẫu cấu hình client dựng từ `origin` của trang + khóa vừa tạo (khóa đã chép sẵn vào từng mẫu). */
export function McpClientConfigSnippets({ origin, token }: { origin: string; token: string }) {
  const snippets = buildMcpClientConfig(origin, token)
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Địa chỉ cổng MCP: <span className="font-mono text-foreground">{snippets.url}</span>
      </p>
      <p className="text-sm text-muted-foreground">
        claude.ai, ChatGPT và mục Connectors của Claude Desktop không cần khóa này: dán địa chỉ trên vào phần thêm kết nối, đăng nhập
        trang quản trị bot rồi bấm <span className="font-semibold text-foreground">Cho phép</span>. Kết nối hiện ở danh sách với loại
        Kết nối OAuth.
      </p>
      <Snippet title="Claude Code" code={snippets.claudeCode} label="lệnh Claude Code" />
      <Snippet title="Codex (config.toml)" code={snippets.codex} label="cấu hình Codex" />
      <Snippet title="Claude Desktop / client MCP khác (JSON)" code={snippets.genericJson} label="cấu hình JSON" />
      <Snippet title="Kiểm nhanh bằng curl" code={snippets.curlCheck} label="lệnh curl" />
    </div>
  )
}
