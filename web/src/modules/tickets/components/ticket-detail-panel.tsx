import type { ReactNode } from 'react'

import { Card } from '@/shared/ui/card'
import { SectionHeading } from '@/shared/ui/section-heading'
import { formatDateTime } from '@/shared/utils/format-date'
import { TICKET_STATUS, type TicketDetail } from '../types/ticket'
import { formatTicketSource } from '../utils/format-ticket-source'
import { TicketAttachments } from './ticket-attachments'
import { TicketEventTimeline } from './ticket-event-timeline'
import { TicketStatusBadge } from './ticket-status-badge'

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    //  minmax(0,1fr): cột giá trị co được — tên nhóm dài liền một mạch không đẩy thẻ tràn ngang.
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/** Thân trang chi tiết ticket (khe `renderExtra` của `CrudDetailPage`, màn chỉ xem): nội dung, thông tin, tệp, nhật ký. */
export function TicketDetailPanel({ ticket }: { ticket: TicketDetail }) {
  const resolutionLabel = ticket.status === TICKET_STATUS.cancelled ? 'Lý do hủy' : 'Kết quả xử lý'
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="gap-4 p-4 sm:p-5">
          <SectionHeading>Nội dung</SectionHeading>
          {/*  Giữ xuống dòng như người gửi gõ trên Zalo — gộp thành một khối thì danh sách các bước đọc không ra. */}
          <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">
            {ticket.body || <span className="text-muted-foreground">Không có nội dung thêm ngoài tiêu đề.</span>}
          </p>
          {ticket.resolution && (
            <>
              <SectionHeading>{resolutionLabel}</SectionHeading>
              <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{ticket.resolution}</p>
            </>
          )}
        </Card>

        <Card className="gap-2 p-4 sm:p-5">
          <SectionHeading>Thông tin</SectionHeading>
          <dl className="divide-y">
            <InfoRow label="Trạng thái">
              <TicketStatusBadge status={ticket.status} />
            </InfoRow>
            <InfoRow label="Người gửi">{ticket.requester_name || ticket.requester_uid || '—'}</InfoRow>
            <InfoRow label="Báo từ">{formatTicketSource(ticket)}</InfoRow>
            <InfoRow label="Người xử lý">{ticket.handler_name || <span className="text-muted-foreground">Chưa ai nhận</span>}</InfoRow>
            <InfoRow label="Tạo lúc">{formatDateTime(ticket.created_at)}</InfoRow>
            <InfoRow label="Nhận lúc">{formatDateTime(ticket.accepted_at) || '—'}</InfoRow>
            <InfoRow label="Đóng lúc">{formatDateTime(ticket.closed_at) || '—'}</InfoRow>
            <InfoRow label="Cập nhật">{formatDateTime(ticket.updated_at)}</InfoRow>
          </dl>
        </Card>
      </div>

      <TicketAttachments attachments={ticket.attachments ?? []} />
      <TicketEventTimeline events={ticket.events ?? []} />
    </div>
  )
}
