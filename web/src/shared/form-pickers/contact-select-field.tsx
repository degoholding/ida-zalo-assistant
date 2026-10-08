import { useMemo } from 'react'
import { useController, type Control } from 'react-hook-form'

import { getContactOptionLabel } from '@/shared/contact-card/format-contact'
import type { CrudRecord } from '@/shared/crud/types'
import { useContactById } from '@/shared/lookups/use-lookups'
import { ReadOnlyValue } from '@/shared/ui/read-only-value'
import { SearchSelect } from '@/shared/ui/search-select'
import { PickerFieldShell } from './picker-field-shell'
import { useContactOptions } from './use-contact-options'

interface ContactSelectFieldProps {
  control: Control<CrudRecord>
  /** Ô trong form giữ ID người (số); `0` = chưa chọn — đúng như máy chủ trả. */
  name: string
  label: string
  disabled: boolean
  required?: boolean
  hint?: string
}

/**
 * Chọn MỘT người trong Danh bạ cho biểu mẫu CRUD (`type: 'custom'`).
 *
 * Tra phía máy chủ theo từ khóa (xem `useContactOptions`). Người ĐANG LƯU có thể không nằm trong lượt tra đầu —
 * nạp riêng theo id để ô hiện đúng TÊN chứ không hiện con số id trơ trọi.
 */
export function ContactSelectField({ control, name, label, disabled, required, hint }: ContactSelectFieldProps) {
  const { field, fieldState } = useController({
    control,
    name,
    //  Cùng câu với ô bắt buộc của `CrudField`. Kiểm `> 0` chứ không `required`: «chưa chọn» là số 0, không rỗng.
    rules: required ? { validate: (value) => Number(value) > 0 || `${label} là bắt buộc` } : undefined,
  })
  const selectedId = Number(field.value) || 0
  const { options, setKeyword, isFetching } = useContactOptions(!disabled)
  const { data: selectedContact } = useContactById(selectedId)

  const selectedLabel = selectedContact ? getContactOptionLabel(selectedContact) : ''
  const allOptions = useMemo(() => {
    if (!selectedId || !selectedLabel || options.some((option) => option.value === String(selectedId))) return options
    return [{ value: String(selectedId), label: selectedLabel }, ...options]
  }, [options, selectedId, selectedLabel])

  if (disabled) {
    return (
      <PickerFieldShell label={label} hint={hint}>
        <ReadOnlyValue>{selectedId ? selectedLabel || `#${selectedId}` : '—'}</ReadOnlyValue>
      </PickerFieldShell>
    )
  }

  return (
    <PickerFieldShell label={label} htmlFor={name} required={required} hint={hint} error={fieldState.error?.message}>
      <SearchSelect
        id={name}
        value={selectedId ? String(selectedId) : ''}
        onChange={(value) => field.onChange(value ? Number(value) : 0)}
        options={allOptions}
        onSearchChange={setKeyword}
        clearable={!required}
        placeholder="Chọn người trong Danh bạ"
        searchPlaceholder="Gõ tên, mã Zalo, ghi chú…"
        emptyMessage={isFetching ? 'Đang tìm…' : 'Không có ai khớp.'}
      />
    </PickerFieldShell>
  )
}
