import type { ReactNode } from 'react'

import { Label } from '@/shared/ui/label'

interface PickerFieldShellProps {
  label: string
  /** Trỏ nhãn vào ô chọn (chỉ khi ô có `id`). */
  htmlFor?: string
  required?: boolean
  hint?: string
  error?: string
  children: ReactNode
}

/**
 * Nhãn + chú thích + câu lỗi quanh một ô chọn tự vẽ (`type: 'custom'` của khung CRUD).
 *
 * Khung CRUD cố ý KHÔNG bọc nhãn cho ô tự vẽ, nên mỗi ô chọn ở đây tự lo — dựng lại đúng khuôn của `CrudField`
 * (nhãn đậm, dấu sao đỏ, chú thích mờ, lỗi đỏ) để đứng cạnh các ô thường không bị lệch.
 */
export function PickerFieldShell({ label, htmlFor, required, hint, error, children }: PickerFieldShellProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
