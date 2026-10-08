import { Pill } from '@/shared/ui/pill'
import { getTicketStatusLabel, getTicketStatusTone } from '../types/ticket'

/** Nhãn trạng thái ticket — màu theo bảng tông chung (`status-tone.ts`). Mã lạ hiện «Không rõ», không làm vỡ dòng. */
export function TicketStatusBadge({ status }: { status: number }) {
  return <Pill tone={getTicketStatusTone(status)}>{getTicketStatusLabel(status) || 'Không rõ'}</Pill>
}
