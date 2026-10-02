import { History, Loader2 } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { useBackfillGroup } from '../hooks/use-groups'

/** Nút «Lấy tin cũ» ở hàng nút dính của trang chi tiết nhóm, kèm tiến độ khi đang kéo. */
export function GroupBackfillButton({ groupId }: { groupId: number }) {
  const { job, start, isStarting } = useBackfillGroup(groupId)
  const running = Boolean(job?.running)
  return (
    <div className="flex items-center gap-2">
      {running && job && (
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {job.pages} trang · {job.fetched} tin · mới {job.stored}
        </span>
      )}
      <Button variant="outline" size="sm" onClick={() => start(true)} disabled={running || isStarting} title="Kéo toàn bộ lịch sử nhóm từ Zalo về kho (chạy nền, nhóm lớn mất vài phút)">
        {running || isStarting ? <Loader2 className="animate-spin" /> : <History />}
        {running ? 'Đang lấy tin cũ…' : 'Lấy tin cũ'}
      </Button>
    </div>
  )
}
