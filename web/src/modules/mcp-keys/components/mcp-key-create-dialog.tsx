import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import type { CrudFormDialogProps } from '@/shared/crud/types'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { useMcpKeyCreate, useMcpKeyOptions } from '../hooks/use-mcp-key-actions'
import { MCP_ACCESS_LEVEL, MCP_ACCESS_LEVEL_OPTIONS, type McpKeyDetail } from '../types/mcp-key'
import { McpKeyCreatedPanel } from './mcp-key-created-panel'

const NO_EXPIRY = 'never'
const DEFAULT_EXPIRY = '90'
const NAME_MAX = 100

/**
 * Hộp thoại "Thêm khóa MCP" (khe `FormDialog` của khung CRUD). Hai bước: nhập → hiện khóa thô MỘT lần.
 * Khóa thô chỉ nằm trong state `token` của component; đóng hộp thoại là state bị bỏ (đóng = unmount nội dung).
 */
export function McpKeyCreateDialog({ open, onOpenChange }: CrudFormDialogProps<McpKeyDetail>) {
  // Khóa thô đang hiện: Esc / bấm ra ngoài / nút X sẽ làm mất khóa không lấy lại được → chỉ đóng bằng nút "Tôi đã chép khóa"
  const [keyShown, setKeyShown] = useState(false)
  const keepOpen = (event: Event) => { if (keyShown) event.preventDefault() }
  function close() {
    setKeyShown(false)
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else onOpenChange(next) }}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!keyShown}
        onEscapeKeyDown={keepOpen}
        onInteractOutside={keepOpen}
      >
        {/* Bỏ nội dung khi đóng để state (khóa thô, ô đã nhập) không sống sót qua lần mở sau */}
        {open && <CreateDialogBody onClose={close} onKeyShown={() => setKeyShown(true)} />}
      </DialogContent>
    </Dialog>
  )
}

function CreateDialogBody({ onClose, onKeyShown }: { onClose: () => void; onKeyShown: () => void }) {
  const { data: options } = useMcpKeyOptions()
  const create = useMcpKeyCreate()
  const [name, setName] = useState('')
  const [level, setLevel] = useState<string>(String(MCP_ACCESS_LEVEL.read))
  const [expiry, setExpiry] = useState(DEFAULT_EXPIRY)
  const [includeConfidential, setIncludeConfidential] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  // Chưa có giới hạn từ máy chủ thì coi như hẹp nhất (chỉ đọc, không Mật) — không để lộ lựa chọn rồi mới bị từ chối
  const maxLevel = options?.max_access_level ?? MCP_ACCESS_LEVEL.read
  const levelOptions = MCP_ACCESS_LEVEL_OPTIONS.filter((option) => option.value <= maxLevel)
  const canPickConfidential = options?.can_include_confidential === true

  async function submit() {
    const result = await create.mutateAsync({
      name: name.trim(),
      access_level: Number(level),
      include_confidential: canPickConfidential && includeConfidential,
      expires_in_days: expiry === NO_EXPIRY ? null : Number(expiry),
    })
    setToken(result.token)
    onKeyShown()
  }

  if (token) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Đã tạo khóa MCP</DialogTitle>
          <DialogDescription>Dán khóa vào client AI của anh/chị theo một trong các mẫu bên dưới.</DialogDescription>
        </DialogHeader>
        <McpKeyCreatedPanel token={token} origin={window.location.origin} />
        <DialogFooter>
          <Button onClick={onClose}>Tôi đã chép khóa</Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Thêm khóa MCP</DialogTitle>
        <DialogDescription>Khóa cho AI ngoài (Claude, Codex…) đọc dữ liệu bot với đúng quyền tài khoản của anh/chị.</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="mcp-key-name">Tên khóa</Label>
          <Input id="mcp-key-name" value={name} maxLength={NAME_MAX} placeholder="vd Claude máy văn phòng" onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mcp-key-level">Mức quyền</Label>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger id="mcp-key-level" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {levelOptions.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-key-expiry">Hết hạn sau</Label>
            <Select value={expiry} onValueChange={setExpiry}>
              <SelectTrigger id="mcp-key-expiry" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(options?.expiry_days ?? [30, 90, 365]).map((days) => (
                  <SelectItem key={days} value={String(days)}>{days} ngày</SelectItem>
                ))}
                <SelectItem value={NO_EXPIRY}>Không hết hạn</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {canPickConfidential && (
          <div className="flex items-start gap-2">
            <Checkbox id="mcp-key-confidential" checked={includeConfidential} onCheckedChange={(checked) => setIncludeConfidential(checked === true)} />
            <Label htmlFor="mcp-key-confidential" className="flex-col items-start gap-1 leading-snug">
              Cho đọc nhóm Mật
              <span className="text-xs font-normal text-muted-foreground">Khóa này mới xem được tin / tệp của nhóm Mật mà tài khoản được phép xem, và cuộc nhắn riêng của chính anh/chị với bot.</span>
            </Label>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Hủy</Button>
        <Button disabled={!name.trim() || create.isPending} onClick={() => void submit().catch(() => undefined)}>
          {create.isPending && <Loader2 className="animate-spin" />}
          Tạo khóa
        </Button>
      </DialogFooter>
    </>
  )
}
