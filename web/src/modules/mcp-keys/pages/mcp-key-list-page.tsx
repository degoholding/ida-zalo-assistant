import { CrudListPage } from '@/shared/crud/crud-list-page'
import { mcpKeyCrudConfig } from '../config/mcp-key-crud'

export function McpKeyListPage() {
  return <CrudListPage config={mcpKeyCrudConfig} />
}
