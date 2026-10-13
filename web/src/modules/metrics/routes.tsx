import type { RouteObject } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { RouteErrorPage } from '@/shared/ui/route-error-page'
import { METRIC_SOURCE_CREATE_ROUTE } from './config/metric-source-routes'

export const metricsModule: RouteObject[] = [
  {
    path: appRoutes.metrics.list,
    lazy: async () => ({ Component: (await import('./pages/metrics-page')).MetricsPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.metricSources.list,
    lazy: async () => ({ Component: (await import('./pages/metric-source-list-page')).MetricSourceListPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    // Route TĨNH (thêm mới, cùng trang chi tiết — không có `:id` thì `CrudDetailPage` tự vào chế độ tạo); react-router ưu tiên đường
    // tĩnh nên «new» không bị hiểu là id
    path: METRIC_SOURCE_CREATE_ROUTE,
    lazy: async () => ({ Component: (await import('./pages/metric-source-detail-page')).MetricSourceDetailPage }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: appRoutes.metricSources.detail(':id'),
    lazy: async () => ({ Component: (await import('./pages/metric-source-detail-page')).MetricSourceDetailPage }),
    errorElement: <RouteErrorPage />,
  },
]
