import { Pill } from '@/shared/ui/pill'
import { getTaskStatusLabel, getTaskStatusTone } from '../types/task'

/** Nhãn trạng thái việc — màu theo bảng tông chung (`status-tone.ts`). Mã lạ hiện «Không rõ», không làm vỡ dòng. */
export function TaskStatusBadge({ status }: { status: number }) {
  return <Pill tone={getTaskStatusTone(status)}>{getTaskStatusLabel(status) || 'Không rõ'}</Pill>
}
