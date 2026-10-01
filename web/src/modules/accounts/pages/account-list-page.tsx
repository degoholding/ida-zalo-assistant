import { CrudListPage } from '@/shared/crud/crud-list-page'
import { accountCrudConfig } from '../config/account-crud'

export function AccountListPage() {
  return <CrudListPage config={accountCrudConfig} />
}
