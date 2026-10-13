import { Loader2, Power, PowerOff, RefreshCw } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { confirm } from '@/shared/ui/confirm-dialog'
import { useMetricSourceAction } from '../hooks/use-metric-source-action'
import type { MetricSource } from '../types/metric'

/** Nút ở trang chi tiết nguồn: «Đọc ngay» (chạy một lượt đọc trong tiến trình app) và «Bật / Tắt» đọc. */
export function MetricSourceActionButtons({ source }: { source: MetricSource }) {
  const mutation = useMetricSourceAction(source.id)
  const busy = mutation.isPending

  const runToggle = async () => {
    if (source.is_active) {
      const ok = await confirm({
        title: `Tắt đọc nguồn «${source.name}»`,
        message: 'Bot ngừng đọc bảng này và số liệu của nó biến khỏi màn Số liệu / báo cáo (số đã đọc vẫn giữ, bật lại là hiện lại).',
        confirmLabel: 'Tắt đọc',
      })
      if (!ok) return
    }
    mutation.mutate(source.is_active ? 'disable' : 'enable')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => mutation.mutate('sync_now')}>
        {busy && mutation.variables === 'sync_now' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        Đọc ngay
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void runToggle()}>
        {source.is_active ? <PowerOff /> : <Power />}
        {source.is_active ? 'Tắt đọc' : 'Bật đọc'}
      </Button>
    </div>
  )
}
