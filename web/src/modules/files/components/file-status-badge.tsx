import { Pill } from '@/shared/ui/pill'
import type { StatusTone } from '@/shared/ui/status-tone'
import { FILE_STATUS, getFileStatusLabel } from '../types/file'

const STATUS_TONE: Record<number, StatusTone> = {
  [FILE_STATUS.pending]: 'progress',
  [FILE_STATUS.stored]: 'done',
  [FILE_STATUS.failed]: 'danger',
  [FILE_STATUS.skipped]: 'neutral',
  // Không phải lỗi, chỉ là tệp gốc đã dọn theo hạn — tông «xong một phần» (còn chữ, mất tệp)
  [FILE_STATUS.expired]: 'partial',
}

interface FileStatusBadgeProps {
  status: number
  lastError?: string
  /** Tệp đánh dấu «giữ tệp gốc» — hiện thêm nhãn «Giữ» cạnh trạng thái. */
  keepFile?: boolean
}

export function FileStatusBadge({ status, lastError, keepFile }: FileStatusBadgeProps) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <div className="flex flex-wrap items-center gap-1">
        <Pill tone={STATUS_TONE[status] ?? 'neutral'}>{getFileStatusLabel(status)}</Pill>
        {keepFile && (
          <span title="Giữ tệp gốc — không xóa khi hết hạn giữ tệp của nhóm">
            <Pill tone="progress">Giữ</Pill>
          </span>
        )}
      </div>
      {lastError && <span className="max-w-full truncate text-xs text-muted-foreground" title={lastError}>{lastError}</span>}
    </div>
  )
}
