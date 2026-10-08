import { CrudDetailPage } from '@/shared/crud/crud-detail-page'
import { recipientCrudConfig } from '../config/recipient-crud'

/** Chi tiết / sửa người nhận — cũng là trang THÊM MỚI (route `/recipients/new`, không có `:id`). */
export function RecipientDetailPage() {
  return <CrudDetailPage config={recipientCrudConfig} />
}
