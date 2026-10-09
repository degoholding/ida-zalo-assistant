import { Info } from 'lucide-react'

import type { PaginatedResult } from '@/shared/types/api'
import { formatDate } from '@/shared/utils/format-date'
import type { MessageSearchLimits, MessageSearchRecord } from '../types/message-search'

interface MessageSearchNoticeProps {
  result: (PaginatedResult<MessageSearchRecord> & MessageSearchLimits) | undefined
}

/**
 * Ghi chú trên bảng kết quả khi máy chủ phải tự giới hạn: tin cũ còn đang nạp vào bộ tìm, chỉ
 * tìm từ một ngày trở đi (từ khóa phải dò từng tin), hoặc có hơn 1.000 tin khớp. Không giới hạn
 * gì thì không vẽ — để người tìm không tưởng «không thấy» nghĩa là «không có».
 */
export function MessageSearchNotice({ result }: MessageSearchNoticeProps) {
  if (!result) return null
  const lines: string[] = []
  if (result.indexed_from) {
    lines.push(
      `Hệ thống đang nạp tin cũ vào bộ tìm — hiện mới tìm được các tin từ khoảng ${formatDate(result.indexed_from)} trở đi, tin cũ hơn sẽ dần tìm được.`,
    )
  }
  if (result.window_from) {
    lines.push(
      `Từ khóa này phải dò từng tin nên chỉ tìm các tin từ ${formatDate(result.window_from)} trở đi — chọn «Lúc gửi» (từ ngày) ở bộ lọc để tìm xa hơn.`,
    )
  }
  if (result.total_capped) {
    const shown = result.total.toLocaleString('vi-VN')
    lines.push(`Có hơn ${shown} tin khớp, chỉ xem được ${shown} tin mới nhất — thêm từ khóa hoặc bộ lọc để thu hẹp.`)
  }
  if (!lines.length) return null

  return (
    <p role="status" className="mb-2 flex items-start gap-1.5 text-sm text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0" />
      <span>{lines.join(' ')}</span>
    </p>
  )
}
