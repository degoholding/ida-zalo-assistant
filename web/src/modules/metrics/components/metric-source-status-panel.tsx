import { Card } from '@/shared/ui/card'
import { formatDateTime } from '@/shared/utils/format-date'
import type { MetricSource } from '../types/metric'
import { MetricSourceStatusBadge } from './metric-source-status-badge'

/** Khối «Lượt đọc gần nhất» ở trang chi tiết nguồn: trạng thái, giờ đọc, số dòng, lỗi và cảnh báo. */
export function MetricSourceStatusPanel({ source }: { source: MetricSource }) {
  return (
    <Card className="gap-3 p-3 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold">Lượt đọc gần nhất</h3>
        <MetricSourceStatusBadge status={source.status} isActive={source.is_active} />
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Đọc lần cuối</dt>
          <dd>{formatDateTime(source.last_sync_at) || 'Chưa đọc lần nào'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Đọc thành công lần cuối</dt>
          <dd>{formatDateTime(source.last_ok_at) || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Số đọc được</dt>
          <dd>{source.last_row_count}</dd>
        </div>
      </dl>
      {source.last_error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{source.last_error}</p>}
      {source.last_warnings.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Cảnh báo ({source.last_warning_count})</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-warning">
            {source.last_warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
