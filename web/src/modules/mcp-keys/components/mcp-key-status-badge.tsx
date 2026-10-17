import { Pill } from '@/shared/ui/pill'
import type { StatusTone } from '@/shared/ui/status-tone'
import { getMcpKeyStatusLabel } from '../types/mcp-key'

const TONE: Record<string, StatusTone> = { active: 'done', expired: 'pending', revoked: 'danger' }

/** Nhãn trạng thái khóa. Mã lạ hiện «Không rõ», không làm vỡ dòng. */
export function McpKeyStatusBadge({ status }: { status: string }) {
  return <Pill tone={TONE[status] ?? 'neutral'}>{getMcpKeyStatusLabel(status) || 'Không rõ'}</Pill>
}
