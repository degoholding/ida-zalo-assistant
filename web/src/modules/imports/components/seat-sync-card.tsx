import { Loader2, MonitorSmartphone, QrCode } from 'lucide-react'

import { Badge } from '@/shared/ui/badge'
import { Card } from '@/shared/ui/card'
import { SEAT_QR_URL } from '../api/import-api'
import { useSeatStatus } from '../hooks/use-imports'
import type { SeatInfo } from '../types/import'

/** Hai thao tác duy nhất của người có tài khoản Zalo cần lấy tin cũ — phần còn lại ghế tự chạy. */
const STAFF_STEPS = [
  'Mở Zalo trên điện thoại, bấm biểu tượng quét QR cạnh ô tìm kiếm, quét mã đang hiện ở đây (mã tự làm mới khi hết hạn).',
  'Khi điện thoại hỏi "Đồng bộ tin nhắn sang máy tính?", bấm Đồng ý và giữ Zalo mở tới khi báo đồng bộ xong (vài phút, tùy số tin).',
]

function phaseBadge(info: SeatInfo) {
  if (!info.configured) return <Badge variant="outline">Chưa cấu hình</Badge>
  if (!info.reachable) return <Badge variant="secondary">Ghế đang tắt</Badge>
  const status = info.status
  if (!status) return null
  if (status.phase === 'main') {
    if (status.sync?.running) return <Badge>Đang đồng bộ từ điện thoại</Badge>
    return <Badge className="bg-emerald-600 text-white">Đã đăng nhập</Badge>
  }
  if (status.phase.startsWith('login')) return <Badge variant="secondary">Chờ quét QR</Badge>
  return <Badge variant="outline">{status.phase}</Badge>
}

function SeatDetails({ info }: { info: SeatInfo }) {
  if (!info.configured) {
    return (
      <p className="text-sm text-muted-foreground">
        Máy chủ bot chưa đặt <code>SEAT_GATEWAY_URL</code> nên màn này không hỏi được ghế. Quản trị bật ghế bằng lệnh <code>node tools/sync-once.mjs &lt;tên tài khoản&gt;</code> ở
        kho <code>zalo-pc-gateway</code>, rồi trỏ biến đó tới địa chỉ HTTP của cổng (ví dụ <code>http://127.0.0.1:8099</code>).
      </p>
    )
  }
  if (!info.reachable) {
    return (
      <p className="text-sm text-muted-foreground">
        Không nối được tới cổng ghế{info.error ? ` (${info.error})` : ''}. Ghế chỉ chạy khi quản trị đang chạy lệnh <code>sync-once</code>; xong một tài khoản là ghế tự tắt.
      </p>
    )
  }
  const status = info.status
  if (!status) return null
  if (status.phase.startsWith('login')) {
    return (
      <div className="flex flex-wrap items-start gap-4">
        <img
          src={`${SEAT_QR_URL}?t=${status.last_qr_at}`}
          alt="Mã QR đăng nhập Zalo PC"
          className="size-56 rounded-md border bg-white p-1"
        />
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {STAFF_STEPS.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </div>
    )
  }
  if (status.phase === 'main') {
    const sync = status.sync
    return (
      <dl className="grid grid-cols-[200px_1fr] gap-y-1 text-sm">
        <dt className="text-muted-foreground">Tài khoản đang ngồi ghế</dt>
        <dd>
          {status.user?.displayName || '—'} <span className="text-muted-foreground">({status.user?.userId})</span>
        </dd>
        <dt className="text-muted-foreground">Gắn vào bot</dt>
        <dd>
          {status.linked_account
            ? <>Có — tài khoản nghe <span className="font-medium">{status.linked_account}</span>, chat riêng sẽ nhập được</>
            : <span className="text-amber-700">Chưa — chỉ nhập được nhóm, tệp chat riêng sẽ bị bỏ (gắn tài khoản ở màn Tài khoản bot trước)</span>}
        </dd>
        <dt className="text-muted-foreground">Hội thoại trên ghế</dt>
        <dd>{status.conversations || '—'}</dd>
        <dt className="text-muted-foreground">Đồng bộ từ điện thoại</dt>
        <dd className="flex items-center gap-2">
          {sync?.running
            ? <><Loader2 className="size-4 animate-spin" /> đang chạy{sync.progress != null ? ` — ${sync.progress}%` : ''}</>
            : sync?.last_result
              ? `${sync.last_result === 'success' ? 'xong' : sync.last_result}${sync.started_at && sync.finished_at ? ` (${Math.round((sync.finished_at - sync.started_at) / 1000)} giây)` : ''}`
              : sync?.ready ? 'chưa chạy — chờ xác nhận trên điện thoại' : 'dịch vụ chưa sẵn sàng'}
        </dd>
      </dl>
    )
  }
  return <p className="text-sm text-muted-foreground">Ghế đang ở bước: {status.phase}</p>
}

/** Cách 1 — ghế đồng bộ Zalo PC (phase 14): lấy tin cũ nhiều năm từ điện thoại, mỗi tài khoản một lần. */
export function SeatSyncCard() {
  const seat = useSeatStatus()
  const info = seat.data
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonitorSmartphone className="size-5 text-navy" />
        <h2 className="font-semibold text-navy">Cách 1 — Zalo PC (ghế đồng bộ): tin cũ nhiều năm</h2>
        {info ? phaseBadge(info) : seat.isLoading ? <Loader2 className="size-4 animate-spin" /> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Ghế là một Zalo PC chạy trên máy chủ: tài khoản ngồi vào, điện thoại đồng bộ toàn bộ lịch sử sang, ghế xuất tin (cả nhóm lẫn chat riêng, tệp lấy ảnh + PDF) vào kho bot
        rồi tự đăng xuất, nhường chỗ cho tài khoản kế. Người có tài khoản chỉ làm hai thao tác: <QrCode className="inline size-3.5" /> quét QR và bấm Đồng ý trên điện thoại.
      </p>
      {info ? <SeatDetails info={info} /> : seat.isError ? <p className="text-sm text-destructive">Không hỏi được trạng thái ghế.</p> : null}
      {info?.configured && !(info.status?.phase.startsWith('login')) && (
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          {STAFF_STEPS.map((step) => <li key={step}>{step}</li>)}
        </ol>
      )}
    </Card>
  )
}
