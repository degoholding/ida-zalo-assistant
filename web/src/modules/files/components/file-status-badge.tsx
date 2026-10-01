import { Pill } from '@/shared/ui/pill'
import type { StatusTone } from '@/shared/ui/status-tone'
import { FILE_STATUS, getFileStatusLabel } from '../types/file'

const STATUS_TONE: Record<number, StatusTone> = {
  [FILE_STATUS.pending]: 'progress',
  [FILE_STATUS.stored]: 'done',
  [FILE_STATUS.failed]: 'danger',
  [FILE_STATUS.skipped]: 'neutral',
}

export function FileStatusBadge({ status, lastError }: { status: number; lastError?: string }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <Pill tone={STATUS_TONE[status] ?? 'neutral'}>{getFileStatusLabel(status)}</Pill>
      {lastError && <span className="max-w-full truncate text-xs text-muted-foreground" title={lastError}>{lastError}</span>}
    </div>
  )
}
