import { useController, type Control } from 'react-hook-form'

import { usePermission } from '@/core/authorization/use-permission'
import { CONTACT_ROLE_OPTIONS } from '@/shared/contact-card/contact-constants'
import type { CrudRecord } from '@/shared/crud/types'
import { Label } from '@/shared/ui/label'
import { ReadOnlyValue } from '@/shared/ui/read-only-value'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

const ROLE_HINT =
  'Có vai trò thì bot trả lời khi người này nhắn riêng. Trong nhóm: nhân sự gọi được bot (cài đặt "Trong nhóm: nhân sự gọi được bot"), khách hàng thì không. Chỉ quản trị đổi được.'

interface ContactRoleFieldProps {
  control: Control<CrudRecord>
  name: string
  disabled: boolean
}

/**
 * Ô "Vai trò với bot" của hồ sơ Danh bạ. Vai trò này mở quyền gửi lệnh / tắt bot nên CHỈ quản trị (`user.write`) đổi được —
 * người khác thấy chữ, không thấy ô chọn. Máy chủ vẫn chặn riêng (403), đây chỉ là phần hiển thị.
 */
export function ContactRoleField({ control, name, disabled }: ContactRoleFieldProps) {
  const { field } = useController({ control, name })
  const { can } = usePermission()
  const current = String(field.value ?? '')
  const matched = CONTACT_ROLE_OPTIONS.find((option) => String(option.value) === current)

  if (disabled || !can('user', 'write')) {
    return (
      <div className="space-y-1.5">
        <Label>Vai trò với bot</Label>
        <ReadOnlyValue>{matched?.label ?? '—'}</ReadOnlyValue>
        <p className="text-xs text-muted-foreground">{ROLE_HINT}</p>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>Vai trò với bot</Label>
      <Select value={matched ? current : ''} onValueChange={(value) => { if (value !== '') field.onChange(value) }}>
        <SelectTrigger id={name} className="w-full">
          <SelectValue placeholder="Chọn vai trò với bot" />
        </SelectTrigger>
        <SelectContent>
          {CONTACT_ROLE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{ROLE_HINT}</p>
    </div>
  )
}
