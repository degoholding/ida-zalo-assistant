import { CircleAlert, ListChecks } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader } from '@/shared/ui/card'
import { Pill } from '@/shared/ui/pill'
import { Skeleton } from '@/shared/ui/skeleton'
import type { StatusTone } from '@/shared/ui/status-tone'
import { formatDateTime } from '@/shared/utils/format-date'
import { useSchedules } from '../hooks/use-schedules'
import { ScheduleRunStatus, type ScheduleStatus } from '../types/schedule'
import { formatRunDuration } from '../utils/format-run-duration'

const RUN_STATUS_META: Record<ScheduleRunStatus, { label: string; tone: StatusTone }> = {
  [ScheduleRunStatus.NeverRun]: { label: 'Chưa chạy', tone: 'neutral' },
  [ScheduleRunStatus.Running]: { label: 'Đang chạy', tone: 'active' },
  [ScheduleRunStatus.Done]: { label: 'Xong', tone: 'done' },
  [ScheduleRunStatus.Failed]: { label: 'Lỗi', tone: 'danger' },
}

/** Dòng phụ dưới tên việc: lịch + lượt gần nhất (lúc bắt đầu, chạy mất bao lâu). */
function describeLastRun(item: ScheduleStatus): string {
  if (!item.lastStartedAt) return `Lịch: ${item.schedule} · chưa chạy lần nào`
  const parts = [`Lịch: ${item.schedule}`, `lần gần nhất ${formatDateTime(item.lastStartedAt)}`]
  // Đang chạy thì thời gian của lượt trước không còn đúng — không hiện cho khỏi hiểu nhầm
  if (item.lastStatus !== ScheduleRunStatus.Running && item.lastFinishedAt) {
    const duration = formatRunDuration(item.lastDurationMs)
    if (duration) parts.push(`chạy ${duration}`)
  }
  return parts.join(' · ')
}

/**
 * Thẻ CHỈ ĐỌC «Việc chạy theo lịch» dưới tab Vận hành: sao lưu, dọn tệp, bản tin… chạy lúc nào, lượt gần nhất xong hay lỗi.
 * Tự nạp lại mỗi phút (`useSchedules`) — không có nút sửa, lịch khai trong mã máy chủ.
 */
export function ScheduleStatusCard() {
  const { data, isLoading, isError, refetch } = useSchedules()
  const items = data ?? []

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-row items-start gap-3 border-b px-5 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ListChecks className="size-4" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-sm font-semibold text-navy dark:text-foreground">Việc chạy theo lịch</h3>
          <p className="text-xs text-muted-foreground">Bot tự chạy các việc này theo giờ. Trang tự cập nhật mỗi phút.</p>
        </div>
      </CardHeader>
      <CardContent className="px-5 py-3 text-sm">
        {isLoading && <Skeleton className="h-24 w-full" />}
        {isError && (
          <div className="flex flex-wrap items-center gap-3 py-2">
            <p className="text-destructive">Không tải được danh sách việc chạy theo lịch.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              Thử lại
            </Button>
          </div>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <p className="py-2 text-muted-foreground">Chưa có việc nào chạy theo lịch.</p>
        )}
        {items.length > 0 && (
          <ul className="divide-y">
            {items.map((item) => {
              const meta = RUN_STATUS_META[item.lastStatus] ?? RUN_STATUS_META[ScheduleRunStatus.NeverRun]
              return (
                <li key={item.name} className="space-y-1 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{item.label}</span>
                    <Pill tone={meta.tone}>{meta.label}</Pill>
                  </div>
                  <p className="text-xs text-muted-foreground">{describeLastRun(item)}</p>
                  {item.lastStatus === ScheduleRunStatus.Failed && item.lastError && (
                    <p className="flex items-start gap-1 text-xs break-words text-destructive">
                      <CircleAlert className="mt-px size-3.5 shrink-0" />
                      {item.lastError}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
