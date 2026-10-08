import type { Ticket } from '../types/ticket'

/**
 * Ticket báo từ đâu: tên nhóm, «Tin riêng», hay «—» khi không rõ nguồn (cuộc trò chuyện đã bị dọn).
 * Nhóm mất tên vẫn phải nói được là NHÓM — để trống thì người đọc tưởng là tin riêng.
 */
export function formatTicketSource(ticket: Pick<Ticket, 'source_kind' | 'source_name'>): string {
  if (ticket.source_kind === 'group') return ticket.source_name.trim() || 'Nhóm (chưa rõ tên)'
  if (ticket.source_kind === 'direct') return 'Tin riêng'
  return '—'
}
