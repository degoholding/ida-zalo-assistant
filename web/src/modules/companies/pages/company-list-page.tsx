import { CrudListPage } from '@/shared/crud/crud-list-page'
import { companyCrudConfig } from '../config/company-crud'

export function CompanyListPage() {
  return <CrudListPage config={companyCrudConfig} />
}
