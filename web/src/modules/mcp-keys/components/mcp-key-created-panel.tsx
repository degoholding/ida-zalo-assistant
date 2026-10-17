import { TriangleAlert } from 'lucide-react'

import { CopyButton } from '@/shared/ui/copy-button'
import { McpClientConfigSnippets } from './mcp-client-config-snippets'

/** Bước 2 của hộp thoại tạo: khóa thô hiện MỘT lần + cảnh báo + mẫu cấu hình client. */
export function McpKeyCreatedPanel({ token, origin }: { token: string; origin: string }) {
  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>Chỉ hiện một lần. Chép khóa ngay bây giờ — đóng hộp thoại này là không xem lại được, chỉ còn cách thu hồi và tạo khóa mới.</span>
      </div>
      <div className="space-y-1">
        <span className="text-sm font-medium">Khóa của anh/chị</span>
        <div className="flex items-center gap-1 rounded-md border bg-muted/50 px-2.5 py-1.5">
          <code className="min-w-0 flex-1 font-mono text-xs break-all" data-testid="mcp-key-token">{token}</code>
          <CopyButton value={token} label="khóa" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Lưu ý: dán khóa thẳng vào lệnh (<code className="font-mono">--header</code>, <code className="font-mono">export</code>) sẽ để lại khóa trong lịch sử shell — xóa dòng đó khỏi lịch sử hoặc dùng biến môi trường.
      </p>
      <McpClientConfigSnippets origin={origin} token={token} />
    </div>
  )
}
