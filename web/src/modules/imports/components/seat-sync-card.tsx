import { CheckCircle2, Loader2, LogOut, Power, PowerOff, Smartphone, TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { confirm } from '@/shared/ui/confirm-dialog'
import { Input } from '@/shared/ui/input'
import { SEAT_QR_URL } from '../api/import-api'
import { useSeatLogout, useSeatStart, useSeatStatus, useSeatStop } from '../hooks/use-imports'
import type { SeatInfo, SeatJob } from '../types/import'
import { isSeatBusy } from '../utils/seat-busy'

/** Hai việc của người quét: quét QR, bấm Đồng ý trên điện thoại. Phần còn lại ghế tự chạy. */
const STAFF_STEPS = [
  'Mở Zalo trên điện thoại, bấm biểu tượng QR cạnh ô tìm kiếm, quét mã này.',
  'Điện thoại hỏi đồng bộ tin nhắn sang máy tính: bấm Đồng ý, giữ Zalo mở.',
]

const STAGE_LABELS: Record<SeatJob['stage'], string> = {
  login: 'Chờ quét QR',
  sync: 'Điện thoại đang gửi tin sang ghế',
  export: 'Ghế đang xuất tin',
  import: 'Đang nạp vào kho bot',
  done: 'Xong',
  error: 'Lỗi',
}

function phaseBadge(info: SeatInfo) {
  if (!info.configured || !info.reachable) return <Badge variant="secondary">Ghế đang tắt</Badge>
  const status = info.status
  if (!status) return null
  if (status.phase === 'main') {
    const stage = status.job?.stage
    if (stage === 'done') return <Badge className="bg-emerald-600 text-white">Xong</Badge>
    if (stage === 'error') return <Badge variant="destructive">Lỗi</Badge>
    if (isSeatBusy(info)) return <Badge>Đang đồng bộ</Badge>
    return <Badge className="bg-emerald-600 text-white">Đã đăng nhập</Badge>
  }
  if (status.phase.startsWith('login')) return <Badge variant="secondary">Chờ quét QR</Badge>
  return <Badge variant="outline">{status.phase}</Badge>
}

function elapsed(from: number | null, to: number | null): string {
  if (!from) return '—'
  const seconds = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes} phút ${String(seconds % 60).padStart(2, '0')} giây` : `${seconds} giây`
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums text-navy">{value}</div>
    </div>
  )
}

function Progress({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2">
          {percent < 100 && <Loader2 className="size-4 animate-spin" />}
          {label}
        </span>
        <span className="font-semibold tabular-nums">{percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function LogoutButton({ disabled }: { disabled: boolean }) {
  const logout = useSeatLogout()
  const onClick = async () => {
    const ok = await confirm({
      title: 'Đăng xuất ghế',
      message: 'Tài khoản rời ghế, ghế tắt. Tin đã nhập vẫn giữ trong kho bot.',
      confirmLabel: 'Đăng xuất',
      tone: 'default',
    })
    if (ok) logout.mutate()
  }
  return (
    <Button variant="outline" onClick={onClick} disabled={disabled || logout.isPending}>
      {logout.isPending ? <Loader2 className="animate-spin" /> : <LogOut />}
      Đăng xuất ghế
    </Button>
  )
}

function LoggedIn({ info }: { info: SeatInfo }) {
  const status = info.status!
  const job = status.job
  const sync = status.sync
  const busy = isSeatBusy(info)
  const percent = job ? job.percent : sync?.running ? (sync.progress ?? 0) : 0
  const label = job ? (job.note ? `${STAGE_LABELS[job.stage]} · ${job.note}` : STAGE_LABELS[job.stage]) : sync?.running ? 'Điện thoại đang gửi tin sang ghế' : 'Đã đăng nhập, chưa chạy đồng bộ'
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">{status.user?.displayName || '—'}</span>
        <span className="text-muted-foreground">{status.user?.userId}</span>
        {status.linked_account
          ? <span className="text-emerald-700">Đã gắn vào bot ({status.linked_account})</span>
          : <span className="text-amber-700">Chưa gắn vào bot: chỉ nhập được nhóm</span>}
      </div>
      {job?.stage === 'error'
        ? <p className="flex items-center gap-2 text-sm text-destructive"><TriangleAlert className="size-4" /> {job.error || 'Việc ghế lỗi'}</p>
        : <Progress percent={percent} label={label} />}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Cuộc trò chuyện" value={job?.conversations ? `${job.conversations.done}/${job.conversations.total}` : String(status.conversations || '—')} />
        <Stat label="Tệp đính kèm" value={job?.media == null ? '—' : job.media.toLocaleString('vi-VN')} />
        <Stat label="Tin đã nhập" value={job?.messages ? `${job.messages.imported.toLocaleString('vi-VN')}${job.messages.duplicates ? ` (+${job.messages.duplicates.toLocaleString('vi-VN')} trùng)` : ''}` : '—'} />
        <Stat label="Thời gian" value={elapsed(job?.started_at ?? sync?.started_at ?? null, job?.finished_at ?? null)} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <LogoutButton disabled={busy} />
        {job?.stage === 'done' && <span className="flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="size-4" /> Xong. Bấm Đăng xuất để trả ghế.</span>}
        {busy && <span className="text-xs text-muted-foreground">Đang chạy, chưa đăng xuất được.</span>}
        {(busy || job?.stage === 'error') && <StopSeatButton info={info} />}
      </div>
    </div>
  )
}

/** Ô tên + nút Bật ghế (14.9): chỉ Quản trị, chỉ khi có dịch vụ bật ghế trên máy chủ. Tên = thư mục giữ dữ liệu đã đồng bộ. */
function StartSeatForm({ info }: { info: SeatInfo }) {
  const launcher = info.launcher
  const start = useSeatStart()
  const [account, setAccount] = useState('')
  if (!launcher?.configured || !launcher.can_control) return null
  if (!launcher.reachable) return <p className="text-sm text-amber-700">Dịch vụ bật ghế trên máy chủ không trả lời{launcher.error ? ` (${launcher.error})` : ''}.</p>
  const valid = /^[\w.-]{1,40}$/.test(account.trim())
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) start.mutate(account.trim(), { onSuccess: () => setAccount('') })
      }}
    >
      <Input value={account} onChange={(event) => setAccount(event.target.value)} placeholder="Tên tài khoản, vd giabao" className="w-56" aria-label="Tên tài khoản ngồi ghế" />
      <Button type="submit" disabled={!valid || start.isPending}>
        {start.isPending ? <Loader2 className="animate-spin" /> : <Power />}
        Bật ghế
      </Button>
      <span className="text-xs text-muted-foreground">Chỉ chữ, số, dấu chấm, gạch. Bật xong mã QR hiện ở đây trong vài giây.</span>
    </form>
  )
}

/** Nút Tắt ghế (14.9): dừng script + gỡ container, kể cả khi đang chờ quét. */
function StopSeatButton({ info }: { info: SeatInfo }) {
  const launcher = info.launcher
  const stop = useSeatStop()
  if (!launcher?.configured || !launcher.can_control || !launcher.running) return null
  const onClick = async () => {
    const ok = await confirm({
      title: 'Tắt ghế',
      message: `Dừng ghế ${launcher.account ?? ''} ngay. Phần đang đồng bộ hoặc đang nạp dở sẽ mất, tin đã nạp vẫn giữ.`,
      confirmLabel: 'Tắt ghế',
    })
    if (ok) stop.mutate(undefined)
  }
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={stop.isPending}>
      {stop.isPending ? <Loader2 className="animate-spin" /> : <PowerOff />}
      Tắt ghế
    </Button>
  )
}

function SeatBody({ info }: { info: SeatInfo }) {
  if (!info.configured || !info.reachable) {
    const launcher = info.launcher
    if (launcher?.running) {
      return (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Đang bật ghế {launcher.account}, chờ mã QR…</p>
          <StopSeatButton info={info} />
        </div>
      )
    }
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {launcher?.configured && launcher.can_control ? 'Ghế đang tắt. Nhập tên tài khoản rồi bấm Bật ghế, mã QR hiện ở đây.' : 'Ghế đang tắt. Khi quản trị bật ghế, mã QR hiện ở đây.'}
        </p>
        {launcher?.finished_at && launcher.exit_code !== null && launcher.exit_code !== 0 && launcher.log_tail.length > 0 && (
          <p className="text-xs text-destructive">
            Lượt trước ({launcher.account}) kết thúc lỗi: {launcher.log_tail.filter((line) => /LỖI|Error|hết giờ/.test(line)).pop() ?? launcher.log_tail[launcher.log_tail.length - 1]}
          </p>
        )}
        <StartSeatForm info={info} />
      </div>
    )
  }
  const status = info.status
  if (!status) return null
  if (status.phase.startsWith('login')) {
    return (
      <div className="flex flex-wrap items-center gap-6">
        <img src={`${SEAT_QR_URL}?t=${status.last_qr_at}`} alt="Mã QR đăng nhập Zalo" className="size-64 rounded-md border bg-white p-2" />
        <div className="max-w-sm space-y-3">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {STAFF_STEPS.map((step) => <li key={step}>{step}</li>)}
            <li className="text-muted-foreground">Mã tự làm mới. Xong hai bước là ghế tự chạy, theo dõi ở đây.</li>
          </ol>
          <StopSeatButton info={info} />
        </div>
      </div>
    )
  }
  if (status.phase === 'main') return <LoggedIn info={info} />
  return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {status.phase}</p>
}

/** Ghế đồng bộ Zalo PC (phase 14): quét QR, điện thoại gửi toàn bộ lịch sử, ghế nạp vào kho bot rồi đăng xuất. */
export function SeatSyncCard() {
  const seat = useSeatStatus()
  const info = seat.data
  return (
    <Card className="gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Smartphone className="size-5 text-navy" />
        <h2 className="font-semibold text-navy">Đồng bộ lịch sử Zalo</h2>
        {info ? phaseBadge(info) : seat.isLoading ? <Loader2 className="size-4 animate-spin" /> : null}
      </div>
      {info ? <SeatBody info={info} /> : seat.isError ? <p className="text-sm text-destructive">Không hỏi được trạng thái ghế.</p> : null}
    </Card>
  )
}
