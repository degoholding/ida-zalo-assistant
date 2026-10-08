import { TICKET_STATUS, type TicketAction } from '../types/ticket'

/**
 * Nút thao tác hiện được với một trạng thái, theo đúng thứ tự bày trên hàng nút.
 *
 * Khớp luật của `src/tickets/ticket-service.ts`: nhận / xong / hủy chỉ khi ticket còn MỞ, mở lại chỉ khi đã ĐÓNG,
 * nhắn người gửi lúc nào cũng được. «Nhận xử lý» chỉ hiện ở ticket Mới — ticket đang có người làm thì không mời
 * người khác giành. Mã trạng thái lạ chỉ còn «Nhắn người gửi»: không đoán bừa ticket đang mở hay đóng.
 */
export function getTicketActions(status: number): TicketAction[] {
  switch (status) {
    case TICKET_STATUS.new:
      return ['accept', 'done', 'cancel', 'note']
    case TICKET_STATUS.inProgress:
      return ['done', 'cancel', 'note']
    case TICKET_STATUS.done:
    case TICKET_STATUS.cancelled:
      return ['reopen', 'note']
    default:
      return ['note']
  }
}
