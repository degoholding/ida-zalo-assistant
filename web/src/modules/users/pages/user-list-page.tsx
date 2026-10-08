import { CrudListPage } from '@/shared/crud/crud-list-page'
import { userCrudConfig } from '../config/user-crud'

export function UserListPage() {
  return <CrudListPage config={userCrudConfig} />
}
