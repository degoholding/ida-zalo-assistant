import { CrudDetailPage } from '@/shared/crud/crud-detail-page'
import { userCrudConfig } from '../config/user-crud'

/** Chi tiết / sửa người dùng — cũng là trang THÊM MỚI (route `/users/new`, không có `:id`). */
export function UserDetailPage() {
  return <CrudDetailPage config={userCrudConfig} />
}
