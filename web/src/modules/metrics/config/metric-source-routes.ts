import { appRoutes } from '@/shared/constants/app-routes'

/** Trang thêm nguồn — route TĨNH trỏ vào `CrudDetailPage` (chế độ tạo mới), khai ở `createRoute` của `metricSourceCrudConfig`. */
export const METRIC_SOURCE_CREATE_ROUTE = `${appRoutes.metricSources.list}/new`
