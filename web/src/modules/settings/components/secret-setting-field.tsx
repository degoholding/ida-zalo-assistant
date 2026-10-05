import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Control } from 'react-hook-form'
import { useController } from 'react-hook-form'

import { Button } from '@/shared/ui/button'
import { confirm } from '@/shared/ui/confirm-dialog'
import { CopyButton } from '@/shared/ui/copy-button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Pill } from '@/shared/ui/pill'
import { Textarea } from '@/shared/ui/textarea'
import type { SettingFormValues, SettingView } from '../types/setting'

interface SecretSettingFieldProps {
  setting: SettingView
  control: Control<SettingFormValues>
  disabled?: boolean
  onDelete: () => void
  deletePending?: boolean
}

/**
 * Ô BÍ MẬT — máy chủ không bao giờ trả giá trị thật nên ô này KHÔNG BAO GIỜ
 * được prefill. Đang đặt (`is_set`) thì chỉ hiện gợi ý (`hint`) + nút Đổi/Xóa;
 * bấm Đổi mới mở ô nhập trống. Khóa service account hiện thêm `client_email`
 * (chính là `hint` của nó) kèm nút chép, để dán vào bước chia sẻ trang tính.
 */
export function SecretSettingField({ setting, control, disabled, onDelete, deletePending }: SecretSettingFieldProps) {
  const { field } = useController({ control, name: setting.key })
  const [editing, setEditing] = useState(!setting.is_set)
  const inputId = `setting-${setting.key}`

  async function handleDelete() {
    const ok = await confirm({
      title: 'Xóa cài đặt',
      message: `Xóa "${setting.label}"? Thao tác này không hoàn tác được — phải nhập lại từ đầu.`,
      confirmLabel: 'Xóa',
    })
    if (ok) onDelete()
  }

  const showSummary = !editing && setting.is_set
  // «Xóa» = xóa giá trị đặt trên web; khóa đang lấy từ .env thì xóa ở đây không có tác dụng
  const isWeb = setting.source === 'web'

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>{setting.label}</Label>

      {showSummary ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Đã đặt{setting.hint && ` · ${setting.hint}`}</span>
          {/* Chỉ email service account cần chép (dán vào bước chia sẻ trang tính) */}
          {setting.type === 'json' && setting.hint && <CopyButton value={setting.hint} label={setting.label} />}
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setEditing(true)}>
            <Pencil /> Đổi
          </Button>
          {isWeb && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={disabled || deletePending}
              onClick={() => void handleDelete()}
            >
              {deletePending ? <Loader2 className="animate-spin" /> : <Trash2 />} Xóa
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {setting.type === 'json' ? (
            <Textarea
              id={inputId}
              rows={8}
              className="font-mono text-xs"
              placeholder="Dán nguyên nội dung tệp .json"
              value={(field.value as string) ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              disabled={disabled}
            />
          ) : (
            <Input
              id={inputId}
              value={(field.value as string) ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              placeholder="Dán giá trị mới"
              autoComplete="off"
              disabled={disabled}
            />
          )}
          {setting.is_set && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                field.onChange('')
                setEditing(false)
              }}
            >
              Hủy — giữ giá trị cũ
            </Button>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{setting.help}</p>
      {setting.is_set && (
        <Pill tone={isWeb ? 'done' : 'neutral'}>{isWeb ? 'đặt trên web' : 'từ .env — muốn tắt thì xóa trong .env'}</Pill>
      )}
    </div>
  )
}
