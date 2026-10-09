import { CrudListPage } from '@/shared/crud/crud-list-page'
import { messageSearchCrudConfig } from '../config/message-search-crud'

/** Màn «Tìm tin» (phase 6 — N4): tìm tin nhắn cũ theo từ khóa + nhóm / người / khoảng ngày. */
export function MessageSearchPage() {
  return <CrudListPage config={messageSearchCrudConfig} />
}
