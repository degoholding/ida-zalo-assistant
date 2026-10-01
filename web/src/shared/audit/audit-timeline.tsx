import { ChevronsUp, History, ScrollText } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { usePermission } from '@/core/authorization/use-permission'
import { appRoutes } from '@/shared/constants/app-routes'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'
import { formatDateTime } from '@/shared/utils/format-date'
import { cn } from '@/shared/utils/cn'
import type { AuditLogEntry } from './audit-api'
import { useAuditLogs } from './use-audit-logs'

/** Số dòng hiện thêm mỗi lần bấm "Xem thêm". */
const PAGE_STEP = 10
/** Trần của backend (`limit` mặc định ở `/api/audit-logs`). */
const BACKEND_LIMIT = 100

interface AuditTimelineProps {
  /** Tên entity như backend ghi log: `company`, `department`, `employee`… */
  entity: string
  entityId: number
  /**
   * Danh mục dùng chung chỉ cần "ai làm gì lúc nào"; chứng từ mới cần đọc thêm
   * phần diễn giải trong `message`.
   */
  showMessage?: boolean
  /**
   * Chỉ hiện `message` (lùi về `action_label` khi rỗng), KHÔNG kèm nhãn hành động.
   * Dùng khi backend đã ghi câu tự mô tả đủ "ai làm gì + đổi gì" (vd Đặt xe:
   * "Chỉnh sửa: Thời gian giao, Điểm đến"), tránh lặp "Cập nhật: Chỉnh sửa: …".
   */
  messageOnly?: boolean
  /** Bố cục gọn dành cho trang chứng từ xếp các khối full-width. */
  dense?: boolean
  /**
   * Tùy chọn: hành động gắn vào MỘT dòng nhật ký (vd nút «Hoàn tác»). Trả về
   * `null` cho dòng không có hành động. Mặc định không có — timeline chỉ đọc.
   */
  renderEntryAction?: (log: AuditLogEntry) => ReactNode
}

/**
 * "Lịch sử thao tác" của một bản ghi.
 *
 * Chỉ hiện 10 dòng gần nhất rồi mới cho bung: bản ghi bị sửa nhiều có tới hàng
 * chục dòng log, đổ hết ra thì khối này dài hơn cả nội dung chính, trong khi
 * gần như lúc nào người dùng cũng chỉ cần vài thao tác cuối. API trả MỚI NHẤT
 * TRƯỚC nên cắt từ đầu mảng là đúng thứ tự cần.
 */
export function AuditTimeline({
  entity,
  entityId,
  showMessage = false,
  messageOnly = false,
  dense = false,
  renderEntryAction,
}: AuditTimelineProps) {
  const [visible, setVisible] = useState(PAGE_STEP)
  const { data: logs, isLoading } = useAuditLogs(entity, entityId)
  const { can } = usePermission()

  //  Gác đúng luật của `_can_read_logs` bên backend: `audit` HOẶC `setting`. Hiện
  //  nút cho người không mở được màn đó thì cú bấm rơi thẳng vào trang 403, mà từ
  //  đây họ không đoán ra vì sao — dòng thời gian này thì ai cũng đọc được.
  const canReadSystemLogs = can('audit', 'read') || can('setting', 'read')

  const total = logs?.length ?? 0
  const remaining = total - visible

  return (
    <Card className={cn(dense && 'gap-4 py-4')}>
      {/*
        `pb-3!`: `CardHeader` có luật `[.border-b]:pb-6` (selector kép, thắng
        class thường) — không đánh important thì thẻ này cao hơn các thẻ khác
        cùng trang dù khai cùng một mức đệm.
      */}
      <CardHeader
        className={cn(dense && 'min-h-9 flex flex-row items-center gap-3 border-b px-4 pb-3!')}
      >
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-muted-foreground" />
          Lịch sử thao tác
        </CardTitle>
      </CardHeader>

      <CardContent className={cn(dense && 'px-4')}>
        {isLoading && <Skeleton className="h-24 w-full" />}

        {!isLoading && total === 0 && (
          <p className="py-4 text-sm text-muted-foreground">Chưa có thao tác nào.</p>
        )}

        {!isLoading && total > 0 && (
          <>
            <ol className="space-y-3">
              {logs?.slice(0, visible).map((log, index) => {
                const action = renderEntryAction?.(log)
                return (
                  <li key={`${log.at}-${index}`} className="flex gap-3">
                    <span
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        dotColor(log.action),
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <b>{log.by}</b> —{' '}
                        {messageOnly
                          ? log.message || log.action_label
                          : `${log.action_label}${showMessage && log.message ? `: ${log.message}` : ''}`}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>{formatDateTime(log.at)}</span>
                        {canReadSystemLogs && log.request_id && (
                          <>
                            <span aria-hidden>·</span>
                            {/*
                              Dòng này chỉ kể «ai làm gì»; lượt gọi bên kia mới có
                              giá trị TRƯỚC/SAU, thân yêu cầu, IP và thiết bị. Nối
                              bằng `request_id` chứ không bằng thời điểm — hai
                              thao tác trong cùng một giây là chuyện thường.
                            */}
                            <Link
                              to={appRoutes.system.logDetail(log.request_id)}
                              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                              title={
                                log.changed_fields
                                  ? `Trường đã đổi: ${log.changed_fields}`
                                  : 'Xem lượt gọi API đã sinh ra dòng này'
                              }
                            >
                              <ScrollText className="size-3" />
                              Xem lượt gọi
                              {Boolean(log.change_count) && ` (${log.change_count} trường)`}
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                    {action && <div className="shrink-0">{action}</div>}
                  </li>
                )
              })}
            </ol>

            {(remaining > 0 || visible > PAGE_STEP) && (
              <div className="mt-3 flex gap-2">
                {remaining > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVisible((n) => n + PAGE_STEP)}
                  >
                    Xem thêm {Math.min(remaining, PAGE_STEP)} thao tác
                    {remaining > PAGE_STEP ? ` (còn ${remaining})` : ''}
                  </Button>
                )}
                {visible > PAGE_STEP && (
                  <Button variant="ghost" size="sm" onClick={() => setVisible(PAGE_STEP)}>
                    <ChevronsUp />
                    Thu gọn
                  </Button>
                )}
              </div>
            )}

            {/* Chạm trần thì phải nói ra, không người đọc tưởng chỉ có chừng đó thao tác. */}
            {total >= BACKEND_LIMIT && remaining <= 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Chỉ hiện {BACKEND_LIMIT} thao tác gần nhất.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Xanh lá = việc thành, đỏ = việc hỏng/hủy, còn lại xanh thương hiệu. */
function dotColor(action: AuditLogEntry['action']): string {
  if (['create', 'approved', 'paid'].includes(action)) return 'bg-emerald-500'
  if (['delete', 'rejected', 'cancelled'].includes(action)) return 'bg-destructive'
  return 'bg-primary'
}
