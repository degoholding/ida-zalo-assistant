import type { ReactNode } from 'react'

import { Card } from '@/shared/ui/card'
import { SectionHeading } from '@/shared/ui/section-heading'
import { formatDateTime } from '@/shared/utils/format-date'
import { getBriefTriggerLabel, isBriefReportKind, type BriefDetail } from '../types/brief'
import { BriefFileLinks } from './brief-file-links'
import { BriefStatusBadge } from './brief-status-badge'

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/** Thân trang chi tiết bản tin (khe `renderExtra` của `CrudDetailPage`, màn CHỈ XEM): thông tin + nội dung + tệp. */
export function BriefBodyPanel({ brief }: { brief: BriefDetail }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="gap-2 p-4 sm:p-5">
          <SectionHeading>Thông tin</SectionHeading>
          <dl className="divide-y">
            <InfoRow label="Trạng thái">
              <BriefStatusBadge status={brief.status} kind={brief.kind} created_at={brief.created_at} />
            </InfoRow>
            <InfoRow label="Người nhận">{brief.recipient_name}</InfoRow>
            <InfoRow label="Kỳ">{brief.period_label}</InfoRow>
            <InfoRow label="Cách gửi">{getBriefTriggerLabel(brief.trigger_source) || '—'}</InfoRow>
            <InfoRow label="Điểm tin AI">
              {brief.has_ai ? 'Có' : <span title={brief.ai_note || undefined}>Không{brief.ai_note ? ` — ${brief.ai_note}` : ''}</span>}
            </InfoRow>
            {brief.error && (
              <InfoRow label="Lỗi">
                <span className="text-destructive">{brief.error}</span>
              </InfoRow>
            )}
          </dl>
        </Card>

        <Card className="gap-4 p-4 sm:p-5">
          <SectionHeading>Mốc thời gian</SectionHeading>
          <dl className="divide-y">
            <InfoRow label="Soạn lúc">{formatDateTime(brief.created_at)}</InfoRow>
            <InfoRow label="Gửi lúc">{formatDateTime(brief.sent_at) || '—'}</InfoRow>
          </dl>
        </Card>
      </div>

      <Card className="gap-3 p-4 sm:p-5">
        <SectionHeading>Nội dung bản tin</SectionHeading>
        {brief.body ? (
          // Giữ nguyên xuống dòng / khoảng cách như tin Zalo thật — không gộp dòng (whitespace-pre-wrap, không phải pre-line)
          <p className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{brief.body}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Chưa có nội dung (đang soạn, hoặc soạn lỗi).</p>
        )}
      </Card>

      {isBriefReportKind(brief.kind) && (
        <Card className="gap-3 p-4 sm:p-5">
          <SectionHeading>Tệp đính kèm ({brief.files.length})</SectionHeading>
          <BriefFileLinks files={brief.files} />
        </Card>
      )}
    </div>
  )
}
