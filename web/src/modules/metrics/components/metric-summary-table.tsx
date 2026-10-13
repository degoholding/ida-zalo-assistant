import { ArrowDown, ArrowUp } from 'lucide-react'

import { DataTable, type DataTableColumn } from '@/shared/data-table'
import { cn } from '@/shared/utils/cn'
import { formatDate, formatDateTime } from '@/shared/utils/format-date'
import type { MetricGroupBy, MetricSummary, MetricSummaryRow } from '../types/metric'
import { formatChangePercent, formatMetricNumber } from '../utils/format-metric-number'

const TOTAL_KEY = '__total__'
const GROUP_LABEL: Record<MetricGroupBy, string> = { staff: 'Nhân viên', area: 'Khu vực', date: 'Ngày' }

/** Mũi tên + % đổi: tăng xanh, giảm đỏ, không so được thì «—». */
function ChangeCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>
  const Icon = value >= 0 ? ArrowUp : ArrowDown
  return (
    <span className={cn('inline-flex items-center gap-1 font-medium', value > 0 && 'text-success', value < 0 && 'text-destructive')}>
      {value !== 0 && <Icon className="size-3.5" />}
      {formatChangePercent(value)}
    </span>
  )
}

/** Dòng TỔNG ghim cuối — chỉ khi lọc đúng một chỉ tiêu (cộng nhiều đơn vị là vô nghĩa). */
function buildRows(summary: MetricSummary, groupBy: MetricGroupBy): MetricSummaryRow[] {
  if (!summary.single_metric || summary.rows.length === 0) return summary.rows
  const total: MetricSummaryRow = {
    key: TOTAL_KEY, label: 'TỔNG', value: summary.total.value, previous: summary.total.previous,
    change_pct: summary.total.change_pct, flag_count: summary.total.flag_count,
  }
  return groupBy === 'date' ? [...summary.rows, { ...total, previous: null, change_pct: null }] : [...summary.rows, total]
}

interface MetricSummaryTableProps {
  summary: MetricSummary | undefined
  groupBy: MetricGroupBy
  isLoading: boolean
  isError: boolean
}

/** Bảng tổng hợp (gộp theo NV / khu vực / ngày) trên `@/shared/data-table` — dòng TỔNG nằm cuối, in đậm. */
export function MetricSummaryTable({ summary, groupBy, isLoading, isError }: MetricSummaryTableProps) {
  const showPrevious = groupBy !== 'date'
  const bold = (row: MetricSummaryRow) => (row.key === TOTAL_KEY ? 'font-semibold' : '')
  const columns: DataTableColumn<MetricSummaryRow>[] = [
    {
      key: 'label', header: GROUP_LABEL[groupBy], hideable: false, wrap: true, minWidth: 160,
      cell: (row) => <span className={bold(row)}>{groupBy === 'date' && row.key !== TOTAL_KEY ? formatDate(row.key) : row.label}</span>,
    },
    {
      key: 'value', header: `Kỳ này${summary?.unit ? ` (${summary.unit})` : ''}`, align: 'right', width: 150,
      cell: (row) => <span className={bold(row)}>{formatMetricNumber(row.value)}</span>,
    },
    ...(showPrevious
      ? [
          { key: 'previous', header: 'Kỳ trước', align: 'right' as const, width: 150, cell: (row: MetricSummaryRow) => <span className={bold(row)}>{formatMetricNumber(row.previous)}</span> },
          { key: 'change_pct', header: 'Đổi', align: 'right' as const, width: 120, cell: (row: MetricSummaryRow) => <ChangeCell value={row.change_pct} /> },
        ]
      : []),
    { key: 'flag_count', header: 'Số cờ', align: 'right', width: 90, cell: (row) => (row.flag_count ? <span className="font-medium text-warning">{row.flag_count}</span> : '—') },
  ]
  return (
    <div className="space-y-2">
      <DataTable
        columns={columns}
        rows={summary ? buildRows(summary, groupBy) : undefined}
        getRowId={(row) => row.key}
        isLoading={isLoading}
        isError={isError}
        emptyMessage="Không có số liệu nào trong khoảng này — kiểm tra chỉ tiêu, khoảng ngày hoặc xem nguồn đã đọc chưa (màn Nguồn số liệu)."
        rowClassName={(row) => (row.key === TOTAL_KEY ? 'bg-muted/60!' : undefined)}
        storageKey="metrics.summary"
      />
      {summary && (
        <p className="text-xs text-muted-foreground">
          Nguồn: {summary.sources.join(', ') || '—'}
          {summary.last_ok_at ? `, đọc lúc ${formatDateTime(summary.last_ok_at)}` : ''}
          {summary.previous_period && showPrevious ? ` · Kỳ trước: ${formatDate(summary.previous_period.from)} – ${formatDate(summary.previous_period.to)}` : ''}
        </p>
      )}
    </div>
  )
}
