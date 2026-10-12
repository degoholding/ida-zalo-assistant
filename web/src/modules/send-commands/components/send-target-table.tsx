import { Link } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { Pill } from '@/shared/ui/pill'
import type { StatusTone } from '@/shared/ui/status-tone'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { formatDateTime } from '@/shared/utils/format-date'
import { getSendTargetKindLabel, getSendTargetStatusLabel, SEND_TARGET_STATUS, type SendTarget } from '../types/send-command'

const TARGET_STATUS_TONE: Record<number, StatusTone> = {
  [SEND_TARGET_STATUS.pending]: 'neutral',
  [SEND_TARGET_STATUS.queued]: 'progress',
  [SEND_TARGET_STATUS.sent]: 'done',
  [SEND_TARGET_STATUS.failed]: 'danger',
  [SEND_TARGET_STATUS.cancelled]: 'neutral',
}

/** Từng nơi nhận của một lệnh: loại, trạng thái, lỗi, lúc gửi, và link mở cuộc hội thoại nếu đã có cuộc. */
export function SendTargetTable({ targets }: { targets: SendTarget[] }) {
  if (!targets.length) return <p className="text-sm text-muted-foreground">Lệnh này không có nơi nhận nào.</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nơi nhận</TableHead>
          <TableHead>Loại</TableHead>
          <TableHead>Trạng thái</TableHead>
          <TableHead>Lỗi</TableHead>
          <TableHead>Lúc gửi</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {targets.map((target) => (
          <TableRow key={target.id}>
            <TableCell className="font-medium">{target.display_name || '—'}</TableCell>
            <TableCell>{getSendTargetKindLabel(target.kind) || '—'}</TableCell>
            <TableCell>
              <Pill tone={TARGET_STATUS_TONE[target.status] ?? 'neutral'}>{getSendTargetStatusLabel(target.status) || 'Không rõ'}</Pill>
              {target.attempt_no > 1 && <span className="ml-2 text-xs text-muted-foreground">lần {target.attempt_no}</span>}
            </TableCell>
            <TableCell className="max-w-64 text-destructive [overflow-wrap:anywhere] whitespace-normal">{target.error || ''}</TableCell>
            <TableCell className="text-muted-foreground">{formatDateTime(target.sent_at) || '—'}</TableCell>
            <TableCell className="text-right">
              {target.thread_id !== null && (
                <Link className="text-sm text-primary underline-offset-2 hover:underline" to={appRoutes.conversations.detail(target.thread_id)}>
                  Mở hội thoại
                </Link>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
