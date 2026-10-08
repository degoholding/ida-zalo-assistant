import { CrudListPage } from '@/shared/crud/crud-list-page'
import { recipientCrudConfig } from '../config/recipient-crud'

export function RecipientListPage() {
  return <CrudListPage config={recipientCrudConfig} />
}
