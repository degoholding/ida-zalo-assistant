import { usePermission } from '@/core/authorization/use-permission'
import { Label } from '@/shared/ui/label'
import { Switch } from '@/shared/ui/switch'
import { useUpdateThreadCapture } from '../hooks/use-conversations'
import type { ThreadDetail } from '../types/conversation'

/**
 * Cột hồ sơ của CUỘC RIÊNG 1-1 (27/10/2026): hai công tắc Đọc tin / Lấy file — chỉ quản trị. Trạng thái đọc từ
 * `GET /api/conversations/:id`, ghi bằng `PATCH` cùng đường (API của Agent 2). Máy chủ chưa trả hai cờ thì không vẽ.
 */
export function DirectCaptureToggles({ thread }: { thread: ThreadDetail }) {
  const { can } = usePermission()
  const update = useUpdateThreadCapture(thread.id)
  if (!can('setting', 'write')) return null
  if (thread.read_messages === undefined && thread.capture_files === undefined) return null

  const readOn = Boolean(thread.read_messages)
  const filesOn = Boolean(thread.capture_files)
  const busy = update.isPending

  return (
    <section className="flex flex-col gap-3 p-4" aria-label="Thu thập dữ liệu cuộc riêng">
      <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Thu thập</div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`direct-read-${thread.id}`} className="text-sm">Đọc tin</Label>
        <Switch
          id={`direct-read-${thread.id}`}
          checked={readOn}
          disabled={busy}
          onCheckedChange={(next) => update.mutate({ read_messages: next })}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`direct-files-${thread.id}`} className="text-sm">Lấy file</Label>
        <Switch
          id={`direct-files-${thread.id}`}
          checked={filesOn}
          disabled={busy}
          onCheckedChange={(next) => update.mutate({ capture_files: next })}
        />
      </div>
      <p className="text-xs text-muted-foreground">Tắt chỉ chặn tin từ lúc tắt, tin cũ vẫn còn.</p>
    </section>
  )
}
