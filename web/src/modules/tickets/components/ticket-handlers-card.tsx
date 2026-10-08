import { UserPlus, X } from 'lucide-react'
import { useState } from 'react'

import { usePermission } from '@/core/authorization/use-permission'
import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { confirm } from '@/shared/ui/confirm-dialog'
import { Skeleton } from '@/shared/ui/skeleton'
import { useTicketHandlerMutations, useTicketHandlers } from '../hooks/use-ticket-handlers'
import type { TicketHandler } from '../types/ticket'
import { TicketHandlerAddDialog } from './ticket-handler-add-dialog'

/**
 * Dải «Người xử lý ticket» trên màn danh sách. Ai cũng xem được; thêm / bỏ chỉ quản trị — máy chủ không khai quyền
 * riêng cho hai đường ghi `/api/ticket-handlers` nên chúng rơi về mặc định `setting.write`, gác giống hệt ở đây.
 */
export function TicketHandlersCard() {
  const { can } = usePermission()
  const canManage = can('setting', 'write')
  const { data: handlers, isLoading } = useTicketHandlers()
  const { add, remove } = useTicketHandlerMutations()
  const [adding, setAdding] = useState(false)

  const removeHandler = async (handler: TicketHandler) => {
    const ok = await confirm({
      title: 'Bỏ người xử lý',
      message: `${handler.name} sẽ thôi nhận tin báo ticket mới và không gõ «nhận / xong T-…» trên Zalo được nữa.`,
      confirmLabel: 'Bỏ',
    })
    if (ok) remove.mutate(handler.contact_id)
  }

  return (
    <Card className="mb-3 gap-3 p-3 md:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Người xử lý ticket</h2>
          <p className="text-xs text-muted-foreground">
            Những người này nhận tin báo ticket mới qua Zalo và gõ được «nhận T-12», «xong T-12 &lt;ghi chú&gt;».
          </p>
        </div>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <UserPlus />
            Thêm người
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-8 w-64" />
      ) : !handlers?.length ? (
        <p className="text-sm text-muted-foreground">
          Chưa có ai — ticket mới sẽ không báo cho ai.{canManage ? ' Bấm «Thêm người» để chọn trong Danh bạ.' : ''}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {handlers.map((handler) => (
            <li key={handler.contact_id} className="flex items-center gap-2 rounded-full border bg-background py-1 pr-2 pl-1 text-sm">
              <EntityAvatar name={handler.name || '?'} avatarUrl={handler.avatar_url} cardUid={handler.zalo_uid} className="size-6" />
              <span className="max-w-48 truncate">{handler.name || handler.zalo_uid}</span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => void removeHandler(handler)}
                  disabled={remove.isPending}
                  aria-label={`Bỏ ${handler.name}`}
                  title="Bỏ người xử lý"
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <TicketHandlerAddDialog
          open
          onOpenChange={setAdding}
          pending={add.isPending}
          onSubmit={(contactId) => add.mutate(contactId, { onSuccess: () => setAdding(false) })}
        />
      )}
    </Card>
  )
}
