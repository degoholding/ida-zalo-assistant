import { X } from 'lucide-react'
import { useController, type Control } from 'react-hook-form'

import type { CrudRecord } from '@/shared/crud/types'
import { Badge } from '@/shared/ui/badge'
import { ReadOnlyValue } from '@/shared/ui/read-only-value'
import { SearchSelect } from '@/shared/ui/search-select'
import { PickerFieldShell } from './picker-field-shell'
import { useContactOptions } from './use-contact-options'

/** Một người đã chọn — mang sẵn TÊN để hiện chip mà không phải hỏi lại máy chủ từng người. */
export interface ContactRef {
  contact_id: number
  name: string
}

interface ContactMultiSelectFieldProps {
  control: Control<CrudRecord>
  /** Ô trong form giữ MẢNG `ContactRef` (không phải mảng id) — đổi sang id ở `buildPayload` của config. */
  name: string
  label: string
  disabled: boolean
  /** Trần số người chọn được — khớp trần của máy chủ. */
  max: number
  hint?: string
}

/** Đọc giá trị ô thành mảng `ContactRef` sạch — dữ liệu lạ (chuỗi rỗng của form mới…) thì coi như chưa chọn ai. */
function readContactRefs(value: unknown): ContactRef[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is ContactRef => typeof item === 'object' && item !== null && Number((item as ContactRef).contact_id) > 0,
  )
}

/**
 * Chọn NHIỀU người trong Danh bạ (vd «Người VIP» của người nhận).
 *
 * Không dùng `MultiPicker`: nó lọc tại chỗ trên danh sách đang cầm, mà Danh bạ phải tra phía máy chủ. Thay vào đó
 * một ô tìm để THÊM từng người + dải chip để BỎ — đủ cho trần vài chục người.
 */
export function ContactMultiSelectField({ control, name, label, disabled, max, hint }: ContactMultiSelectFieldProps) {
  const { field } = useController({ control, name })
  const selected = readContactRefs(field.value)
  const { contacts, options, setKeyword, isFetching } = useContactOptions(!disabled)
  const isFull = selected.length >= max
  const selectedIds = new Set(selected.map((item) => item.contact_id))

  const add = (value: string) => {
    const id = Number(value)
    if (!id || selectedIds.has(id) || isFull) return
    const option = options.find((item) => item.value === value)
    const contact = contacts.find((item) => item.id === id)
    field.onChange([...selected, { contact_id: id, name: option?.label ?? contact?.display_name ?? `#${id}` }])
  }
  const remove = (id: number) => field.onChange(selected.filter((item) => item.contact_id !== id))

  if (disabled) {
    return (
      <PickerFieldShell label={label} hint={hint}>
        <ReadOnlyValue multiline>{selected.map((item) => item.name).join(', ') || '—'}</ReadOnlyValue>
      </PickerFieldShell>
    )
  }

  return (
    <PickerFieldShell
      label={`${label} (${selected.length}/${max})`}
      htmlFor={name}
      hint={isFull ? `Đã đủ ${max} người — bỏ bớt một người rồi mới thêm được.` : hint}
    >
      <SearchSelect
        id={name}
        value=""
        onChange={add}
        options={options.filter((option) => !selectedIds.has(Number(option.value)))}
        onSearchChange={setKeyword}
        disabled={isFull}
        placeholder="Thêm người trong Danh bạ"
        searchPlaceholder="Gõ tên, mã Zalo, ghi chú…"
        emptyMessage={isFetching ? 'Đang tìm…' : 'Không có ai khớp.'}
      />
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((item) => (
            <Badge key={item.contact_id} variant="secondary" className="gap-1 font-normal">
              {item.name}
              <button
                type="button"
                aria-label={`Bỏ ${item.name}`}
                onClick={() => remove(item.contact_id)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </PickerFieldShell>
  )
}
