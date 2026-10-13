import { Pill } from '@/shared/ui/pill'
import type { StatusTone } from '@/shared/ui/status-tone'
import { CATALOG_MATCH_STATUS, getCatalogMatchStatusLabel } from '../types/catalog'

const MATCH_STATUS_TONE: Record<number, StatusTone> = {
  [CATALOG_MATCH_STATUS.unmatched]: 'neutral',
  [CATALOG_MATCH_STATUS.matched]: 'progress',
  [CATALOG_MATCH_STATUS.suggested]: 'pending',
  [CATALOG_MATCH_STATUS.confirmed]: 'done',
  [CATALOG_MATCH_STATUS.unlinked]: 'neutral',
}

/** Nhãn tình trạng khớp dòng danh mục với liên hệ Zalo. */
export function CatalogMatchStatusBadge({ status }: { status: number }) {
  const label = getCatalogMatchStatusLabel(status)
  if (!label) return <span className="text-muted-foreground">—</span>
  return <Pill tone={MATCH_STATUS_TONE[status] ?? 'neutral'}>{label}</Pill>
}
