import { CrudDetailPage } from '@/shared/crud/crud-detail-page'
import { contactCrudConfig } from '../config/contact-crud'

/** Hồ sơ một người — khung chi tiết của ERP (`CrudDetailPage`): thẻ danh tính, biểu mẫu, tab, lịch sử thay đổi. */
export function ContactDetailPage() {
  return <CrudDetailPage config={contactCrudConfig} />
}
