import { CrudListPage } from '@/shared/crud/crud-list-page'
import { metricSourceCrudConfig } from '../config/metric-source-crud'

/** Danh sách nguồn số liệu (chỉ quản trị). Nút "Thêm nguồn số liệu" của khung dẫn sang trang tạo (`createRoute`). */
export function MetricSourceListPage() {
  return <CrudListPage config={metricSourceCrudConfig} />
}
