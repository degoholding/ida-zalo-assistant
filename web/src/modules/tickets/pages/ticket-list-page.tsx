import { CrudListPage } from '@/shared/crud/crud-list-page'
import { TicketHandlersCard } from '../components/ticket-handlers-card'
import { ticketCrudConfig } from '../config/ticket-crud'

/** Danh sách ticket, kèm dải «Người xử lý ticket» ngay trên bảng. */
export function TicketListPage() {
  return <CrudListPage config={ticketCrudConfig} beforeContent={<TicketHandlersCard />} />
}
