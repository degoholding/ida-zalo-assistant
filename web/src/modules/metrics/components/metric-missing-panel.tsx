import { Clock, UserX } from 'lucide-react'
import { useState } from 'react'

import { DatePicker } from '@/shared/ui/date-picker'
import { ErrorState } from '@/shared/ui/error-state'
import { Label } from '@/shared/ui/label'
import { Skeleton } from '@/shared/ui/skeleton'
import { DataTable, type DataTableColumn } from '@/shared/data-table'
import { useMetricMissing } from '../hooks/use-metric-missing'
import type { MissingReporter } from '../types/metric'
import { getTodayIso } from '../utils/get-this-week-range'

const COLUMNS: DataTableColumn<MissingReporter>[] = [
  { key: 'name', header: 'Nhân viên', hideable: false, wrap: true, cell: (row) => row.name },
  { key: 'code', header: 'Mã', width: 110, cell: (row) => row.code },
  { key: 'region', header: 'Khu vực', width: 160, cell: (row) => row.region || '—' },
  { key: 'manager', header: 'Người quản lý', width: 180, cell: (row) => row.manager || '—' },
]

function Section({ icon, title, rows }: { icon: React.ReactNode; title: string; rows: MissingReporter[] }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title} ({rows.length})
      </h3>
      <DataTable columns={COLUMNS} rows={rows} getRowId={(row) => row.id} emptyMessage="Không có ai." />
    </section>
  )
}

/** Tab «Chưa báo»: chọn ngày → nhân viên chưa báo / báo muộn (sau 18:15). Chưa tới 18:00 thì chưa kết luận. */
export function MetricMissingPanel() {
  const [date, setDate] = useState(getTodayIso())
  const { data, isLoading, isError } = useMetricMissing(date)
  return (
    <div className="space-y-4">
      <div className="max-w-52 space-y-1.5">
        <Label className="text-xs text-muted-foreground">Ngày</Label>
        <DatePicker value={date} onChange={(next) => next && setDate(next)} />
      </div>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {isError && <ErrorState title="Không tải được danh sách chưa báo" description="Thử tải lại trang." />}
      {data && !data.ready && (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Chưa tới 18:00 ngày này (hoặc chưa có nguồn nào đánh dấu «báo hằng ngày» đang bật) nên chưa tính ai là chưa báo.
        </p>
      )}
      {data?.ready && (
        <div className="space-y-6">
          <Section icon={<UserX className="size-4 text-destructive" />} title="Chưa báo" rows={data.missing} />
          <Section icon={<Clock className="size-4 text-warning" />} title="Báo muộn (sau 18:15)" rows={data.late} />
        </div>
      )}
    </div>
  )
}
