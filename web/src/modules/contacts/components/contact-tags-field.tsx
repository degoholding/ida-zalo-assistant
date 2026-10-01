import { useState } from 'react'
import { useController, type Control } from 'react-hook-form'

import { splitTags } from '@/shared/contact-card/format-contact'
import type { CrudRecord } from '@/shared/crud/types'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { ReadOnlyValue } from '@/shared/ui/read-only-value'

/** Ký tự nối để so hai mảng thẻ — không thể xuất hiện trong thẻ (splitTags đã tách theo , ; xuống dòng). */
const TAG_SEPARATOR = '|'

interface ContactTagsFieldProps {
  control: Control<CrudRecord>
  name: string
  disabled: boolean
}

/**
 * Ô «Thẻ» của biểu mẫu CRUD: giá trị trong form là MẢNG (như API), người dùng gõ chuỗi cách nhau bằng
 * dấu phẩy. Chuỗi đang gõ giữ trong state của ô (để không nuốt dấu phẩy vừa gõ), mỗi phím thì đẩy
 * mảng đã tách vào form; form nạp lại bản ghi (giá trị khác hẳn chuỗi đang gõ) thì đồng bộ ngược.
 */
export function ContactTagsField({ control, name, disabled }: ContactTagsFieldProps) {
  const { field } = useController({ control, name })
  const tags = Array.isArray(field.value) ? (field.value as string[]) : []
  const [text, setText] = useState(tags.join(', '))
  const joined = tags.join(TAG_SEPARATOR)
  // Form nạp lại bản ghi (mảng khác hẳn chuỗi đang gõ) thì đồng bộ ngược ngay trong lượt vẽ —
  // kiểu «điều chỉnh state khi prop đổi» của React, không qua effect để khỏi vẽ hai nhịp
  const [seenJoined, setSeenJoined] = useState(joined)
  if (joined !== seenJoined) {
    setSeenJoined(joined)
    if (splitTags(text).join(TAG_SEPARATOR) !== joined) setText(tags.join(', '))
  }

  if (disabled) {
    return (
      <div className="space-y-1.5">
        <Label>Thẻ</Label>
        <ReadOnlyValue>{tags.join(', ') || '—'}</ReadOnlyValue>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>Thẻ</Label>
      <Input
        id={name}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          field.onChange(splitTags(event.target.value))
        }}
        placeholder="vip, đại lý, miền Nam…"
        maxLength={600}
      />
      <p className="text-xs text-muted-foreground">Cách nhau bằng dấu phẩy. Dùng để lọc Danh bạ.</p>
    </div>
  )
}
