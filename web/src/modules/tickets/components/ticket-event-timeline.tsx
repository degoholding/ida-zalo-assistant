import { EventTimeline } from '@/shared/event-timeline/event-timeline'
import { getTicketEventLabel, type TicketEvent } from '../types/ticket'

/**
 * Nhật ký ticket — khung dòng thời gian chung (09/10/2026, lên `shared/` để màn Việc dùng lại), chỉ còn khai nhãn
 * `TicketEventKind` của riêng ticket.
 */
export function TicketEventTimeline({ events }: { events: TicketEvent[] }) {
  return <EventTimeline events={events} getLabel={getTicketEventLabel} />
}
