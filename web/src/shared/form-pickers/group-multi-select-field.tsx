import { useController, type Control } from 'react-hook-form'

import type { CrudRecord } from '@/shared/crud/types'
import { useGroupLookup } from '@/shared/lookups/use-lookups'
import { MultiPicker } from '@/shared/ui/multi-picker'
import { ReadOnlyValue } from '@/shared/ui/read-only-value'
import { PickerFieldShell } from './picker-field-shell'

interface GroupMultiSelectFieldProps {
  control: Control<CrudRecord>
  /** Ô trong form giữ mảng ID nhóm (số) — đúng dạng máy chủ nhận ở `group_ids`. */
  name: string
  label: string
  disabled: boolean
  hint?: string
}

/** Đọc giá trị ô thành mảng id nhóm hợp lệ — form mới (chưa có gì) thì mảng rỗng. */
function readGroupIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
}

/** Chọn NHIỀU nhóm Zalo (danh sách ngắn `/api/lookups/groups`, lọc tại chỗ). */
export function GroupMultiSelectField({ control, name, label, disabled, hint }: GroupMultiSelectFieldProps) {
  const { field } = useController({ control, name })
  const { data: groups = [] } = useGroupLookup()
  const value = readGroupIds(field.value)
  const options = groups.map((group) => ({ id: group.id, label: group.name || `Nhóm #${group.id}` }))

  if (disabled) {
    const names = value.map((id) => options.find((option) => option.id === id)?.label ?? `Nhóm #${id}`)
    return (
      <PickerFieldShell label={label} hint={hint}>
        <ReadOnlyValue multiline>{names.join(', ') || 'Chưa chọn nhóm nào'}</ReadOnlyValue>
      </PickerFieldShell>
    )
  }

  return (
    <PickerFieldShell label={label} hint={hint}>
      <MultiPicker
        value={value}
        onChange={(ids) => field.onChange(ids)}
        options={options}
        placeholder="Chọn nhóm"
        searchPlaceholder="Gõ tên nhóm…"
        emptyMessage="Không có nhóm nào khớp."
      />
    </PickerFieldShell>
  )
}
