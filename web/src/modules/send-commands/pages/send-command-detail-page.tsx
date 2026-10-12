import { CrudDetailPage } from '@/shared/crud/crud-detail-page'
import { sendCommandCrudConfig } from '../config/send-command-crud'

/** Chi tiết một lệnh gửi — màn CHỈ XEM (`readOnlyDetail`), thao tác qua nút ở `detailActions`. */
export function SendCommandDetailPage() {
  return <CrudDetailPage config={sendCommandCrudConfig} />
}
