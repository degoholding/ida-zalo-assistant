import { CrudListPage } from '@/shared/crud/crud-list-page'
import { catalogCrudConfig } from '../config/catalog-crud'

/** Danh mục NV / ĐL + thanh công cụ tải mẫu / nạp / khớp lại (ở `renderToolbarExtra`). */
export function CatalogListPage() {
  return <CrudListPage config={catalogCrudConfig} />
}
