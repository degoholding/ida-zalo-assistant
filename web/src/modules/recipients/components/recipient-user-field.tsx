import { useController, type Control } from 'react-hook-form'

import type { CrudRecord } from '@/shared/crud/types'
import { PickerFieldShell } from '@/shared/form-pickers/picker-field-shell'
import { ReadOnlyValue } from '@/shared/ui/read-only-value'
import { SearchSelect } from '@/shared/ui/search-select'
import { useRecipientUserOptions } from '../hooks/use-recipient-user-options'
import type { RecipientUserOption } from '../types/recipient'

interface RecipientUserFieldProps {
  control: Control<CrudRecord>
  /** Ô trong form giữ id người dùng (số); `0` = không gắn — đúng như máy chủ trả. */
  name: string
  disabled: boolean
}

const LABEL = 'Tài khoản web'

function formatUserOption(user: RecipientUserOption): string {
  const name = user.full_name ? `${user.full_name} · ${user.email}` : user.email
  return user.is_active ? name : `${name} (đã ngừng)`
}

/** Ô «Tài khoản web» (không bắt buộc) — chọn trong màn Người dùng. */
export function RecipientUserField({ control, name, disabled }: RecipientUserFieldProps) {
  const { field } = useController({ control, name })
  const selectedId = Number(field.value) || 0
  const { data: users = [] } = useRecipientUserOptions()
  const options = users.map((user) => ({ value: String(user.id), label: formatUserOption(user) }))
  const hint = 'Không bắt buộc — gắn để màn hình biết tài khoản web này là người nhận nào.'

  if (disabled) {
    const label = options.find((option) => option.value === String(selectedId))?.label
    return (
      <PickerFieldShell label={LABEL} hint={hint}>
        <ReadOnlyValue>{selectedId ? (label ?? `#${selectedId}`) : 'Không gắn'}</ReadOnlyValue>
      </PickerFieldShell>
    )
  }

  return (
    <PickerFieldShell label={LABEL} htmlFor={name} hint={hint}>
      <SearchSelect
        id={name}
        value={selectedId ? String(selectedId) : ''}
        onChange={(value) => field.onChange(value ? Number(value) : 0)}
        options={options}
        clearable
        placeholder="Không gắn"
        searchPlaceholder="Gõ email, họ tên…"
        emptyMessage="Chưa có người dùng nào khớp — thêm ở màn Người dùng."
      />
    </PickerFieldShell>
  )
}
