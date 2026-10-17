import type { ReactNode } from 'react'

import { Card } from '@/shared/ui/card'
import { SectionHeading } from '@/shared/ui/section-heading'
import { formatDateTime } from '@/shared/utils/format-date'
import { getMcpAccessLevelLabel, type McpKeyDetail } from '../types/mcp-key'
import { McpKeyCallLogTable } from './mcp-key-call-log-table'
import { McpKeyStatusBadge } from './mcp-key-status-badge'

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/** Thân trang chi tiết khóa (khe `renderExtra`, màn chỉ xem): thông tin + 50 lời gọi gần nhất. Không có khóa thô — nó không còn ở máy chủ. */
export function McpKeyDetailPanel({ mcpKey }: { mcpKey: McpKeyDetail }) {
  return (
    <div className="space-y-6">
      <Card className="gap-2 p-4 sm:p-5">
        <SectionHeading>Thông tin</SectionHeading>
        <dl className="divide-y">
          <InfoRow label="Trạng thái"><McpKeyStatusBadge status={mcpKey.status} /></InfoRow>
          <InfoRow label="Tiền tố"><span className="font-mono">{mcpKey.prefix}</span></InfoRow>
          <InfoRow label="Mức quyền">{getMcpAccessLevelLabel(mcpKey.access_level) || '—'}</InfoRow>
          <InfoRow label="Đọc nhóm Mật">{mcpKey.include_confidential ? 'Có' : 'Không'}</InfoRow>
          <InfoRow label="Chủ khóa">{mcpKey.owner_name || '—'}</InfoRow>
          <InfoRow label="Tạo lúc">{formatDateTime(mcpKey.created_at)}</InfoRow>
          <InfoRow label="Hết hạn">{formatDateTime(mcpKey.expires_at) || 'Không hết hạn'}</InfoRow>
          <InfoRow label="Dùng lần cuối">
            {mcpKey.last_used_at ? `${formatDateTime(mcpKey.last_used_at)}${mcpKey.last_used_ip ? ` · IP ${mcpKey.last_used_ip}` : ''}` : 'Chưa dùng'}
          </InfoRow>
          {mcpKey.revoked_at && <InfoRow label="Thu hồi lúc">{formatDateTime(mcpKey.revoked_at)}</InfoRow>}
        </dl>
      </Card>
      <McpKeyCallLogTable calls={mcpKey.recent_calls ?? []} />
    </div>
  )
}
