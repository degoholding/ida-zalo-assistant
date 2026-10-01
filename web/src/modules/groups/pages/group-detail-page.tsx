import { CrudDetailPage } from '@/shared/crud/crud-detail-page'
import { groupCrudConfig } from '../config/group-crud'

export function GroupDetailPage() {
  return <CrudDetailPage config={groupCrudConfig} />
}
