import type { ReactNode } from 'react'

import { Card } from '@/shared/ui/card'
import { SectionHeading } from '@/shared/ui/section-heading'
import { formatDateTime } from '@/shared/utils/format-date'
import { getReminderRepeatLabel, getSendActionKindLabel, getSendCommandSourceLabel, SEND_ACTION_KIND, type SendCommandDetail } from '../types/send-command'
import { SendCommandStatusBadge } from './send-command-status-badge'
import { SendTargetTable } from './send-target-table'

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/** Thân trang chi tiết lệnh gửi (khe `renderExtra` của `CrudDetailPage`): thông tin, nội dung nguyên văn, tệp kèm, từng nơi nhận. */
export function SendCommandBodyPanel({ command }: { command: SendCommandDetail }) {
  const isReminder = command.action_kind === SEND_ACTION_KIND.reminder
  const isPin = command.action_kind === SEND_ACTION_KIND.pin
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="gap-2 p-4 sm:p-5">
          <SectionHeading>Thông tin</SectionHeading>
          <dl className="divide-y">
            <InfoRow label="Trạng thái">
              <SendCommandStatusBadge command={command} />
            </InfoRow>
            <InfoRow label="Loại">{getSendActionKindLabel(command.action_kind) || '—'}</InfoRow>
            <InfoRow label="Nguồn">{getSendCommandSourceLabel(command.source) || '—'}</InfoRow>
            <InfoRow label="Người ra lệnh">{command.requester_name || '—'}</InfoRow>
            {command.cancelled_by && <InfoRow label="Hủy bởi">{command.cancelled_by}</InfoRow>}
            {command.off_hours_note && <InfoRow label="Cảnh báo giờ hẹn">{command.off_hours_note}</InfoRow>}
          </dl>
        </Card>

        <Card className="gap-2 p-4 sm:p-5">
          <SectionHeading>Mốc thời gian</SectionHeading>
          <dl className="divide-y">
            <InfoRow label="Tạo lúc">{formatDateTime(command.created_at)}</InfoRow>
            {isReminder ? (
              <>
                <InfoRow label="Nhắc lúc">{formatDateTime(command.reminder_at) || '—'}</InfoRow>
                <InfoRow label="Lặp">{getReminderRepeatLabel(command.reminder_repeat) || '—'}</InfoRow>
              </>
            ) : isPin ? null : (
              <InfoRow label="Hẹn gửi lúc">{formatDateTime(command.scheduled_at) || 'Gửi ngay'}</InfoRow>
            )}
            <InfoRow label="Báo kết quả">{formatDateTime(command.reported_at) || '—'}</InfoRow>
          </dl>
        </Card>
      </div>

      <Card className="gap-3 p-4 sm:p-5">
        <SectionHeading>{isReminder ? 'Nội dung nhắc' : isPin ? 'Nội dung ghim' : 'Nội dung'}</SectionHeading>
        {/* Giữ nguyên xuống dòng / khoảng cách như tin Zalo thật (whitespace-pre-wrap, không phải pre-line) */}
        <p className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{command.body || '—'}</p>
        {command.files.length > 0 && (
          <p className="text-sm text-muted-foreground">Tệp kèm: {command.files.map((file) => file.file_name || `#${file.id}`).join(', ')}</p>
        )}
      </Card>

      <Card className="gap-3 p-4 sm:p-5">
        <SectionHeading>Nơi nhận ({command.targets.length})</SectionHeading>
        <SendTargetTable targets={command.targets} />
      </Card>
    </div>
  )
}
