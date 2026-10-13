import { Archive, CircleCheck, Loader2, Send, Undo2 } from 'lucide-react'
import { useState } from 'react'

import { usePermission } from '@/core/authorization/use-permission'
import { Button } from '@/shared/ui/button'
import { confirm } from '@/shared/ui/confirm-dialog'
import { useReplyTemplateAction } from '../hooks/use-reply-template-action'
import type { ReplyTemplate, ReplyTemplateAction } from '../types/reply-template'
import { getReplyTemplateActions } from '../utils/get-reply-template-actions'
import { ReplyTemplateReturnDialog } from './reply-template-return-dialog'

/**
 * Nút ở trang chi tiết mẫu tin: Gửi duyệt / Duyệt / Trả lại (kèm ghi chú) / Ngừng dùng. Nút nào hiện theo
 * `getReplyTemplateActions`; quyền thật do máy chủ kiểm (gọi thẳng API không đủ quyền → 403).
 */
export function ReplyTemplateActionButtons({ template }: { template: ReplyTemplate }) {
  const { can } = usePermission()
  const mutation = useReplyTemplateAction(template.id)
  const [returning, setReturning] = useState(false)

  if (!can('reply_template', 'write')) return null

  const actions = getReplyTemplateActions(template)
  const busy = mutation.isPending
  const isRunning = (action: ReplyTemplateAction) => busy && mutation.variables?.action === action

  const runArchive = async () => {
    const ok = await confirm({
      title: 'Ngừng dùng mẫu tin',
      message: 'Bot sẽ không dùng mẫu này nữa. Mẫu không bị xóa; muốn dùng lại thì sửa và gửi duyệt.',
      confirmLabel: 'Ngừng dùng',
    })
    if (ok) mutation.mutate({ action: 'archive' })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.includes('submit') && (
        <Button size="sm" variant="outline" onClick={() => mutation.mutate({ action: 'submit' })} disabled={busy}>
          {isRunning('submit') ? <Loader2 className="animate-spin" /> : <Send />}
          Gửi duyệt
        </Button>
      )}
      {actions.includes('approve') && (
        <Button size="sm" onClick={() => mutation.mutate({ action: 'approve' })} disabled={busy}>
          {isRunning('approve') ? <Loader2 className="animate-spin" /> : <CircleCheck />}
          Duyệt
        </Button>
      )}
      {actions.includes('return') && (
        <Button size="sm" variant="outline" onClick={() => setReturning(true)} disabled={busy}>
          <Undo2 />
          Trả lại
        </Button>
      )}
      {actions.includes('archive') && (
        <Button size="sm" variant="outline" className="text-destructive" onClick={() => void runArchive()} disabled={busy}>
          {isRunning('archive') ? <Loader2 className="animate-spin" /> : <Archive />}
          Ngừng dùng
        </Button>
      )}
      {/* `key` theo mẫu: mở lại cho mẫu khác thì ô ghi chú bắt đầu trống */}
      <ReplyTemplateReturnDialog
        key={template.id}
        open={returning}
        onOpenChange={setReturning}
        pending={isRunning('return')}
        onSubmit={(note) => mutation.mutate({ action: 'return', note }, { onSuccess: () => setReturning(false) })}
      />
    </div>
  )
}
