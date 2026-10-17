import { CrudDetailPage } from '@/shared/crud/crud-detail-page'
import { mcpKeyCrudConfig } from '../config/mcp-key-crud'

/** Chi tiết một khóa — màn CHỈ XEM; thu hồi đi bằng nút ở hàng nút trên đầu trang. */
export function McpKeyDetailPage() {
  return <CrudDetailPage config={mcpKeyCrudConfig} />
}
