import { CrudDetailPage } from '@/shared/crud/crud-detail-page'
import { replyTemplateCrudConfig } from '../config/reply-template-crud'

/** Chi tiết + biểu mẫu soạn một mẫu tin; nút Gửi duyệt / Duyệt / Trả lại / Ngừng dùng ở hàng nút dính (`detailActions`). */
export function ReplyTemplateDetailPage() {
  return <CrudDetailPage config={replyTemplateCrudConfig} />
}
