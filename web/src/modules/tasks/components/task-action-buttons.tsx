import { CalendarClock, Check, CircleCheck, CircleX, Loader2, MessageSquareReply, RotateCcw, UserRoundCog, X } from 'lucide-react'
import { useState } from 'react'

import { usePermission } from '@/core/authorization/use-permission'
import { Button } from '@/shared/ui/button'
import { confirm } from '@/shared/ui/confirm-dialog'
import { useTaskAction } from '../hooks/use-task-action'
import type { TaskAction, TaskDetail } from '../types/task'
import { getTaskActions } from '../utils/get-task-actions'
import { TaskNoteDialog } from './task-note-dialog'
import { TaskReassignDialog } from './task-reassign-dialog'
import { TaskRescheduleDialog } from './task-reschedule-dialog'

/** Ba thao tác đi qua hộp thoại có ô ghi chú. */
type NoteAction = Extract<TaskAction, 'done' | 'cancel' | 'note'>
type DialogState = NoteAction | 'reschedule' | 'reassign' | null

/**
 * Hàng nút thao tác ở trang chi tiết việc. Chỉ người có quyền `task.write` (Quản trị, Quản lý) mới thấy; nút nào
 * hiện theo trạng thái — xem `getTaskActions`. Mọi thao tác đều làm bot báo các bên liên quan qua Zalo.
 */
export function TaskActionButtons({ task }: { task: TaskDetail }) {
  const { can } = usePermission()
  const mutation = useTaskAction(task.id)
  const [dialog, setDialog] = useState<DialogState>(null)

  if (!can('task', 'write')) return null

  const actions = getTaskActions(task.status)
  const busy = mutation.isPending

  const runNoteAction = (action: NoteAction, note: string) =>
    mutation.mutate({ action, note: note || undefined }, { onSuccess: () => setDialog(null) })

  const runConfirm = async () => {
    const ok = await confirm({
      title: `Xác nhận ${task.code}`,
      message: 'Việc chuyển sang Đang làm và bot báo người phụ trách qua Zalo.',
      confirmLabel: 'Xác nhận',
      tone: 'default',
    })
    if (ok) mutation.mutate({ action: 'confirm' })
  }

  const runReject = async () => {
    const ok = await confirm({
      title: `Bỏ đề xuất ${task.code}`,
      message: 'Đề xuất này không phải việc thật — bỏ thì không báo ai (người phụ trách chưa từng được báo).',
      confirmLabel: 'Bỏ đề xuất',
    })
    if (ok) mutation.mutate({ action: 'reject' })
  }

  const runReopen = async () => {
    const ok = await confirm({
      title: `Mở lại ${task.code}`,
      message: 'Việc quay về Đang làm và hiện lại trong danh sách việc mở.',
      confirmLabel: 'Mở lại',
      tone: 'default',
    })
    if (ok) mutation.mutate({ action: 'reopen' })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.includes('confirm') && (
        <Button size="sm" onClick={() => void runConfirm()} disabled={busy}>
          {busy && mutation.variables?.action === 'confirm' ? <Loader2 className="animate-spin" /> : <Check />}
          Xác nhận
        </Button>
      )}
      {actions.includes('reject') && (
        <Button size="sm" variant="outline" className="text-destructive" onClick={() => void runReject()} disabled={busy}>
          <X />
          Bỏ
        </Button>
      )}
      {actions.includes('done') && (
        <Button size="sm" variant="outline" onClick={() => setDialog('done')} disabled={busy}>
          <CircleCheck />
          Xong
        </Button>
      )}
      {actions.includes('reschedule') && (
        <Button size="sm" variant="outline" onClick={() => setDialog('reschedule')} disabled={busy}>
          <CalendarClock />
          Dời hạn
        </Button>
      )}
      {actions.includes('reassign') && (
        <Button size="sm" variant="outline" onClick={() => setDialog('reassign')} disabled={busy}>
          <UserRoundCog />
          Giao lại
        </Button>
      )}
      {actions.includes('note') && (
        <Button size="sm" variant="outline" onClick={() => setDialog('note')} disabled={busy}>
          <MessageSquareReply />
          Ghi chú
        </Button>
      )}
      {actions.includes('cancel') && (
        <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDialog('cancel')} disabled={busy}>
          <CircleX />
          Hủy
        </Button>
      )}
      {actions.includes('reopen') && (
        <Button size="sm" variant="outline" onClick={() => void runReopen()} disabled={busy}>
          {busy && mutation.variables?.action === 'reopen' ? <Loader2 className="animate-spin" /> : <RotateCcw />}
          Mở lại
        </Button>
      )}

      {dialog === 'done' && (
        <TaskNoteDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={`Báo xong ${task.code}`}
          description="Việc chuyển sang Đã xong; bot báo người giao (và người phụ trách nếu khác) kèm ghi chú (nếu có)."
          noteLabel="Ghi chú kết quả"
          placeholder="vd Đã gửi báo giá cho khách"
          confirmLabel="Báo xong"
          pending={busy}
          onSubmit={(note) => runNoteAction('done', note)}
        />
      )}
      {dialog === 'cancel' && (
        <TaskNoteDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={`Hủy ${task.code}`}
          description="Việc chuyển sang Đã hủy và bot báo các bên liên quan. Mở lại được về sau."
          noteLabel="Lý do hủy"
          placeholder="vd Không còn cần nữa"
          confirmLabel="Hủy việc"
          destructive
          pending={busy}
          onSubmit={(note) => runNoteAction('cancel', note)}
        />
      )}
      {dialog === 'note' && (
        <TaskNoteDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={`Ghi chú ${task.code}`}
          description="Bot báo nội dung này cho các bên liên quan qua Zalo, ghi vào nhật ký."
          noteLabel="Nội dung"
          confirmLabel="Gửi"
          required
          pending={busy}
          onSubmit={(note) => runNoteAction('note', note)}
        />
      )}
      {dialog === 'reschedule' && (
        <TaskRescheduleDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          taskCode={task.code}
          pending={busy}
          onSubmit={({ dueDate, dueTime, note }) =>
            mutation.mutate(
              { action: 'reschedule', due_date: dueDate, due_time: dueTime || undefined, note: note || undefined },
              { onSuccess: () => setDialog(null) },
            )
          }
        />
      )}
      {dialog === 'reassign' && (
        <TaskReassignDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          taskCode={task.code}
          currentAssigneeName={task.assignee_name}
          pending={busy}
          onSubmit={(contactId) =>
            mutation.mutate({ action: 'reassign', assignee_contact_id: contactId }, { onSuccess: () => setDialog(null) })
          }
        />
      )}
    </div>
  )
}
