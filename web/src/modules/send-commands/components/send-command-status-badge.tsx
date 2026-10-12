import { Pill } from '@/shared/ui/pill'
import { getSendCommandDisplayStatus, type SendCommandForDisplayStatus } from '../utils/get-send-command-display-status'

/** Nhãn trạng thái lệnh gửi — suy từ `status` + số nơi lỗi (xem `get-send-command-display-status.ts`). */
export function SendCommandStatusBadge({ command }: { command: SendCommandForDisplayStatus }) {
  const display = getSendCommandDisplayStatus(command)
  if (!display.label) return <span className="text-muted-foreground">—</span>
  return <Pill tone={display.tone}>{display.label}</Pill>
}
