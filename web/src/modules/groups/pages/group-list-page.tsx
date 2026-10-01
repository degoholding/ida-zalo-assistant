import { CrudListPage } from '@/shared/crud/crud-list-page'
import { groupCrudConfig } from '../config/group-crud'

export function GroupListPage() {
  return <CrudListPage config={groupCrudConfig} />
}
