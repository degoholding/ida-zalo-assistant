import { Card } from '@/shared/ui/card'
import { Pill } from '@/shared/ui/pill'
import { SectionHeading } from '@/shared/ui/section-heading'
import { formatDateTime } from '@/shared/utils/format-date'
import { getTicketEventLabel, type TicketEvent } from '../types/ticket'

/** Nhật ký ticket, cũ trước mới sau (máy chủ đã xếp theo id) — đọc từ trên xuống như một câu chuyện. */
export function TicketEventTimeline({ events }: { events: TicketEvent[] }) {
  return (
    <Card className="gap-4 p-4 sm:p-5">
      <SectionHeading>Nhật ký</SectionHeading>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có dòng nhật ký nào.</p>
      ) : (
        <ol className="space-y-3 border-l pl-4">
          {events.map((event) => (
            <li key={event.id} className="relative">
              <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-primary" aria-hidden />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-medium">{getTicketEventLabel(event.kind) || 'Khác'}</span>
                <span className="text-muted-foreground">{event.actor_name || '—'}</span>
                <Pill tone={event.via === 'web' ? 'progress' : 'neutral'}>{event.via === 'web' ? 'Web' : 'Zalo'}</Pill>
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
