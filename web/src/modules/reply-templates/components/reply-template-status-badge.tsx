import { Pill } from '@/shared/ui/pill'
import { getReplyTemplateStatusLabel, getReplyTemplateStatusTone } from '../types/reply-template'

/** Nhãn trạng thái mẫu tin — màu theo bảng tông chung. Mã lạ hiện «Không rõ», không làm vỡ dòng. */
export function ReplyTemplateStatusBadge({ status }: { status: number }) {
  return <Pill tone={getReplyTemplateStatusTone(status)}>{getReplyTemplateStatusLabel(status) || 'Không rõ'}</Pill>
}
