import { TriangleAlert } from 'lucide-react'

import { REPLY_TEMPLATE_STATUS, type ReplyTemplate } from '../types/reply-template'

/** Dải "Ghi chú trả lại: …" — chỉ hiện khi mẫu đang ở trạng thái Bị trả lại và có ghi chú. */
export function ReplyTemplateNotePanel({ template }: { template: ReplyTemplate }) {
  if (template.status !== REPLY_TEMPLATE_STATUS.returned || !template.review_note) return null
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p className="whitespace-pre-wrap">
        <span className="font-medium">Ghi chú trả lại: </span>
        {template.review_note}
        {template.reviewer_name && <span className="text-muted-foreground"> ({template.reviewer_name})</span>}
      </p>
    </div>
  )
}
