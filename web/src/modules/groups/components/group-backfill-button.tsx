import { History, Loader2 } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { useBackfillGroup } from '../hooks/use-groups'

/** Nút «Lấy tin cũ» ở hàng nút dính của trang chi tiết nhóm. */
export function GroupBackfillButton({ groupId }: { groupId: number }) {
  const backfill = useBackfillGroup(groupId)
  return (
    <Button variant="outline" size="sm" onClick={() => backfill.mutate()} disabled={backfill.isPending} title="Hỏi Zalo các tin gần nhất của nhóm">
      {backfill.isPending ? <Loader2 className="animate-spin" /> : <History />}
      Lấy tin cũ
    </Button>
  )
}
