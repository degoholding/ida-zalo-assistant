import { CrudDetailPage } from '@/shared/crud/crud-detail-page'
import { metricSourceCrudConfig } from '../config/metric-source-crud'

/**
 * Chi tiết / sửa một nguồn số liệu: biểu mẫu + ánh xạ + đọc thử + trạng thái lượt đọc; nút «Đọc ngay», «Tắt / Bật đọc» ở hàng nút.
 * Cũng là trang THÊM MỚI (route tĩnh `/metric-sources/new`).
 */
export function MetricSourceDetailPage() {
  return <CrudDetailPage config={metricSourceCrudConfig} />
}
