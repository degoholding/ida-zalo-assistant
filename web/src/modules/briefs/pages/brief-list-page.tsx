import { CrudListPage } from '@/shared/crud/crud-list-page'
import { briefCrudConfig } from '../config/brief-crud'

/** Danh sách bản tin / báo cáo đã soạn / gửi — quản trị thấy hết, người khác chỉ thấy bản của mình (phạm vi ở máy chủ). */
export function BriefListPage() {
  return <CrudListPage config={briefCrudConfig} />
}
