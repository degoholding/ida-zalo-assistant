import { CrudDetailPage } from '@/shared/crud/crud-detail-page'
import { companyCrudConfig } from '../config/company-crud'

export function CompanyDetailPage() {
  return <CrudDetailPage config={companyCrudConfig} />
}
