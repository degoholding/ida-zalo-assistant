import { Pill } from '@/shared/ui/pill'
import { getBriefDisplayStatus, getBriefDisplayStatusLabel, getBriefDisplayStatusTone } from '../utils/get-brief-display-status'

/** Nhãn trạng thái bản tin — suy từ `status` + tuổi dòng (xem `get-brief-display-status.ts`), không phải cột thô. */
export function BriefStatusBadge({ status, kind, created_at: createdAt }: { status: number; kind: number; created_at: string }) {
  const display = getBriefDisplayStatus({ status, kind, created_at: createdAt })
  return <Pill tone={getBriefDisplayStatusTone(display)}>{getBriefDisplayStatusLabel(display)}</Pill>
}
