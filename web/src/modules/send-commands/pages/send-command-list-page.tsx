import { CrudListPage } from '@/shared/crud/crud-list-page'
import { sendCommandCrudConfig } from '../config/send-command-crud'

/** Nhật ký lệnh gửi tin + nút Tắt / Bật bot khẩn (ở thanh công cụ, chỉ quản trị thấy). */
export function SendCommandListPage() {
  return <CrudListPage config={sendCommandCrudConfig} />
}
