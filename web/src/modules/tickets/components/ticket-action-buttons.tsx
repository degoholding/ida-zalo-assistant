import { CircleCheck, CircleX, Hand, Loader2, MessageSquareReply, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { usePermission } from '@/core/authorization/use-permission'
import { Button } from '@/shared/ui/button'
import { confirm } from '@/shared/ui/confirm-dialog'
import { useTicketAction } from '../hooks/use-ticket-action'
import type { Ticket, TicketAction } from '../types/ticket'
import { getTicketActions } from '../utils/get-ticket-actions'
import { TicketNoteDialog } from './ticket-note-dialog'

/** Ba thao tác đi qua hộp thoại có ô ghi chú. */
type NoteAction = Extract<TicketAction, 'done' | 'cancel' | 'note'>

/**
 * Hàng nút thao tác ở trang chi tiết ticket. Chỉ người có quyền `ticket.write` (Quản trị, Quản lý) mới thấy;
 * nút nào hiện theo trạng thái — xem `getTicketActions`. Mọi thao tác đều làm bot báo người gửi qua Zalo.
 */
export function TicketActionButtons({ ticket }: { ticket: Ticket }) {
  const { can } = usePermission()
  const mutation = useTicketAction(ticket.id)
  const [dialog, setDialog] = useState<NoteAction | null>(null)

  if (!can('ticket', 'write')) return null

  const actions = getTicketActions(ticket.status)
  const requester = ticket.requester_name || 'người gửi'
  const busy = mutation.isPending

  const runNoteAction = (action: NoteAction, note: string) =>
    mutation.mutate({ action, note: note || undefined }, { onSuccess: () => setDialog(null) })

  const reopen = async () => {
    const ok = await confirm({
      title: `Mở lại ${ticket.code}`,
      message: 'Ticket quay về Đang xử lý (hoặc Mới nếu chưa ai nhận) và hiện lại trong danh sách việc mở.',
      confirmLabel: 'Mở lại',
      tone: 'default',
    })
    if (ok) mutation.mutate({ action: 'reopen' })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.includes('accept') && (
        <Button size="sm" onClick={() => mutation.mutate({ action: 'accept' })} disabled={busy}>
          {busy && mutation.variables?.action === 'accept' ? <Loader2 className="animate-spin" /> : <Hand />}
          Nhận xử lý
        </Button>
      )}
      {actions.includes('done') && (
        <Button size="sm" variant="outline" onClick={() => setDialog('done')} disabled={busy}>
          <CircleCheck />
          Báo xong
        </Button>
      )}
      {actions.includes('reopen') && (
        <Button size="sm" variant="outline" onClick={() => void reopen()} disabled={busy}>
          {busy && mutation.variables?.action === 'reopen' ? <Loader2 className="animate-spin" /> : <RotateCcw />}
          Mở lại
        </Button>
      )}
      {actions.includes('note') && (
        <Button size="sm" variant="outline" onClick={() => setDialog('note')} disabled={busy}>
          <MessageSquareReply />
          Nhắn người gửi
        </Button>
      )}
      {actions.includes('cancel') && (
        <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDialog('cancel')} disabled={busy}>
          <CircleX />
          Hủy
        </Button>
      )}

      {dialog === 'done' && (
        <TicketNoteDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={`Báo xong ${ticket.code}`}
          description={`Ticket chuyển sang Đã xong; bot nhắn ${requester} kèm ghi chú (nếu có).`}
          noteLabel="Ghi chú kết quả"
          placeholder="vd Đã đổi mật khẩu, anh/chị đăng nhập lại giúp em"
          confirmLabel="Báo xong"
          pending={busy}
          onSubmit={(note) => runNoteAction('done', note)}
        />
      )}
      {dialog === 'cancel' && (
        <TicketNoteDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={`Hủy ${ticket.code}`}
          description={`Ticket chuyển sang Đã hủy và bot báo ${requester}. Mở lại được về sau.`}
          noteLabel="Lý do hủy"
          placeholder="vd Trùng với T-0010"
          confirmLabel="Hủy ticket"
          destructive
          pending={busy}
          onSubmit={(note) => runNoteAction('cancel', note)}
        />
      )}
      {dialog === 'note' && (
        <TicketNoteDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title="Nhắn người gửi"
          description={`Bot nhắn riêng nội dung này cho ${requester} qua Zalo, ghi vào nhật ký ${ticket.code}.`}
          noteLabel="Nội dung nhắn"
          confirmLabel="Gửi"
          required
          pending={busy}
          onSubmit={(note) => runNoteAction('note', note)}
        />
      )}
    </div>
  )
}
