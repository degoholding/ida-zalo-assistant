import { CrudDetailPage } from '@/shared/crud/crud-detail-page'
import { accountCrudConfig } from '../config/account-crud'

export function AccountDetailPage() {
  return <CrudDetailPage config={accountCrudConfig} />
}
