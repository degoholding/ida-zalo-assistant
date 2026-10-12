import { SEND_COMMAND_STATUS, type SendCommandAction } from '../types/send-command'

export interface SendCommandForActions {
  status: number
  failed_count: number
}

/**
 * Nút thao tác hiện được, theo luật máy chủ: hủy chỉ khi chờ xác nhận / đang hẹn; gửi lại nơi lỗi chỉ quản trị và chỉ
 * khi lệnh đã chạy xong (hoặc đang gửi) mà còn nơi lỗi. `isAdmin` false → không bao giờ có «gửi lại».
 */
export function getSendCommandActions(command: SendCommandForActions, isAdmin: boolean): SendCommandAction[] {
  const actions: SendCommandAction[] = []
  if (command.status === SEND_COMMAND_STATUS.draft || command.status === SEND_COMMAND_STATUS.scheduled) actions.push('cancel')
  const resendable = command.status === SEND_COMMAND_STATUS.done || command.status === SEND_COMMAND_STATUS.sending
  if (isAdmin && resendable && command.failed_count > 0) actions.push('resend_failed')
  return actions
}
