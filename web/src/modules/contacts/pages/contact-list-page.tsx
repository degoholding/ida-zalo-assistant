import { CrudListPage } from '@/shared/crud/crud-list-page'
import { contactCrudConfig } from '../config/contact-crud'

/** Danh bạ — khung danh sách khai báo của ERP (`CrudListPage`): lọc, sắp xếp, phân trang, cột. */
export function ContactListPage() {
  return <CrudListPage config={contactCrudConfig} />
}
