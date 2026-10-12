import type { StatusTone } from '@/shared/ui/status-tone'
import { SEND_COMMAND_STATUS } from '../types/send-command'

export interface SendCommandForDisplayStatus {
  status: number
  target_count: number
  failed_count: number
}

export interface SendCommandDisplayStatus {
  label: string
  tone: StatusTone
}

/**
 * Trạng thái hiển thị suy từ `status` + số nơi lỗi: «Xong» mà có nơi lỗi thì hiện «Xong — có lỗi (1/3)» để người xem
 * không tưởng lệnh trót lọt. Mã lạ → nhãn rỗng tông trung tính (không đoán).
 */
export function getSendCommandDisplayStatus(command: SendCommandForDisplayStatus): SendCommandDisplayStatus {
  switch (command.status) {
    case SEND_COMMAND_STATUS.draft:
      return { label: 'Chờ xác nhận', tone: 'pending' }
    case SEND_COMMAND_STATUS.scheduled:
      return { label: 'Đang hẹn', tone: 'progress' }
    case SEND_COMMAND_STATUS.sending:
      return { label: 'Đang gửi', tone: 'progress' }
    case SEND_COMMAND_STATUS.done:
      return command.failed_count > 0
        ? { label: `Xong — có lỗi (${command.failed_count}/${command.target_count})`, tone: 'returned' }
        : { label: 'Xong', tone: 'done' }
    case SEND_COMMAND_STATUS.cancelled:
      return { label: 'Đã hủy', tone: 'neutral' }
    case SEND_COMMAND_STATUS.expired:
      return { label: 'Nháp hết hạn', tone: 'neutral' }
    default:
      return { label: '', tone: 'neutral' }
  }
}
