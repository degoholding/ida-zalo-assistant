import { useController, useWatch, type Control } from 'react-hook-form'

import type { CrudRecord } from '@/shared/crud/types'
import { PickerFieldShell } from '@/shared/form-pickers/picker-field-shell'
import { ReadOnlyValue } from '@/shared/ui/read-only-value'
import { Input } from '@/shared/ui/input'

interface PasswordSetFieldProps {
  control: Control<CrudRecord>
  name: string
  disabled: boolean
}

/**
 * Ô ĐẶT mật khẩu cho một người dùng (chỉ đi vào). Để trống = giữ mật khẩu cũ. Máy chủ băm rồi lưu, đổi mật khẩu thì
 * phiên đang mở của người đó văng ra.
 */
export function PasswordSetField({ control, name, disabled }: PasswordSetFieldProps) {
  //  Máy chủ trả `has_password` (không bao giờ trả mật khẩu) — bản ghi đang mở nằm sẵn trong form
  const hasPassword = Boolean(useWatch({ control, name: 'has_password' }))
  const { field } = useController({ control, name, rules: { validate: (value) => !value || String(value).length >= 4 || 'Mật khẩu ít nhất 4 ký tự' } })
  const hint = hasPassword
    ? 'Đã có mật khẩu. Nhập mật khẩu mới để đặt lại, để trống = giữ nguyên.'
    : 'Chưa có mật khẩu — người này chỉ đăng nhập được bằng nút Google. Nhập để cho đăng nhập bằng mật khẩu.'
  if (disabled) {
    return (
      <PickerFieldShell label="Mật khẩu" hint={hint}>
        <ReadOnlyValue>{hasPassword ? 'Đã đặt' : 'Chưa đặt'}</ReadOnlyValue>
      </PickerFieldShell>
    )
  }
  return (
    <PickerFieldShell label="Mật khẩu" htmlFor={name} hint={hint}>
      <Input
        id={name}
        type="password"
        autoComplete="new-password"
        value={String(field.value ?? '')}
        onChange={(event) => field.onChange(event.target.value)}
        onBlur={field.onBlur}
      />
    </PickerFieldShell>
  )
}
