import { CrudDetailPage } from '@/shared/crud/crud-detail-page'
import { ticketCrudConfig } from '../config/ticket-crud'

/** Chi tiết một ticket — màn CHỈ XEM (`readOnlyDetail`), thao tác đi bằng hàng nút trên đầu trang. */
export function TicketDetailPage() {
  return <CrudDetailPage config={ticketCrudConfig} />
}
