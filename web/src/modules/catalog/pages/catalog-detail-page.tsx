import { CrudDetailPage } from '@/shared/crud/crud-detail-page'
import { catalogCrudConfig } from '../config/catalog-crud'

/** Chi tiết một mục danh mục — màn CHỈ XEM (`readOnlyDetail`); chọn / bỏ gắn liên hệ ở khối ứng viên. */
export function CatalogDetailPage() {
  return <CrudDetailPage config={catalogCrudConfig} />
}
