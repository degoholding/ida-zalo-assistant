import { CrudDetailPage } from '@/shared/crud/crud-detail-page'
import { briefCrudConfig } from '../config/brief-crud'

/** Chi tiết một bản tin — màn CHỈ XEM (`readOnlyDetail`), không có nút thao tác nào. */
export function BriefDetailPage() {
  return <CrudDetailPage config={briefCrudConfig} />
}
