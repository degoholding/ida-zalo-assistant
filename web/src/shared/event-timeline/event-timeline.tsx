import { Card } from '@/shared/ui/card'
import { Pill } from '@/shared/ui/pill'
import { SectionHeading } from '@/shared/ui/section-heading'
import { formatDateTime } from '@/shared/utils/format-date'

/** Một dòng nhật ký — hình dạng chung của `ticket_event` / `task_event` ở máy chủ. */
export interface TimelineEvent {
  id: number
  kind: number
  actor_name: string
  via: string
  note: string
  created_at: string
}

interface EventTimelineProps<T extends TimelineEvent> {
  events: T[]
  /** Nhãn tiếng Việt của một mã `kind` — chép tay từ enum máy chủ của phân hệ (vd `TicketEventKind`, `TaskEventKind`). */
  getLabel: (kind: number) => string
  title?: string
  emptyMessage?: string
}

/**
 * Dòng thời gian nhật ký một bản ghi (ticket, việc…), cũ trước mới sau (máy chủ đã xếp theo id) — đọc từ trên
 * xuống như một câu chuyện. Lấy từ `web/src/modules/tickets/components/ticket-event-timeline.tsx` (09/10/2026) vì
 * màn Việc cần đúng khuôn này; phân hệ chỉ còn khai nhãn `kind` của riêng mình.
 */
export function EventTimeline<T extends TimelineEvent>({
  events,
  getLabel,
  title = 'Nhật ký',
  emptyMessage = 'Chưa có dòng nhật ký nào.',
}: EventTimelineProps<T>) {
  return (
    <Card className="gap-4 p-4 sm:p-5">
      <SectionHeading>{title}</SectionHeading>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ol className="space-y-3 border-l pl-4">
          {events.map((event) => (
            <li key={event.id} className="relative">
              <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-primary" aria-hidden />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-medium">{getLabel(event.kind) || 'Khác'}</span>
                <span className="text-muted-foreground">{event.actor_name || '—'}</span>
                <Pill tone={event.via === 'web' ? 'progress' : 'neutral'}>
                  {event.via === 'web' ? 'Web' : event.via === 'system' ? 'Hệ thống' : 'Zalo'}
                </Pill>
                <span className="text-xs text-muted-foreground">{formatDateTime(event.created_at)}</span>
              </div>
              {event.note && <p className="mt-1 text-sm whitespace-pre-line [overflow-wrap:anywhere]">{event.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
