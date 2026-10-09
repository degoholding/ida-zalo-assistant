import { Plus } from 'lucide-react'
import { useState } from 'react'

import { usePermission } from '@/core/authorization/use-permission'
import { Button } from '@/shared/ui/button'
import { TaskCreateDialog } from './task-create-dialog'

/** Nút «Thêm việc» của thanh công cụ danh sách — chỉ Quản trị / Quản lý (`task.write`) thấy, như ticket. */
export function TaskCreateButton() {
  const { can } = usePermission()
  const [open, setOpen] = useState(false)

  if (!can('task', 'write')) return null

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        Thêm việc
      </Button>
      {open && <TaskCreateDialog open onOpenChange={setOpen} />}
    </>
  )
}
