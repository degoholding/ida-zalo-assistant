import { CrudListPage } from '@/shared/crud/crud-list-page'
import { replyTemplateCrudConfig } from '../config/reply-template-crud'

/** Thư viện mẫu tin — lọc nhanh "Chờ duyệt" cho người duyệt; mặc định ẩn mẫu "Ngừng dùng". */
export function ReplyTemplateListPage() {
  return <CrudListPage config={replyTemplateCrudConfig} />
}
