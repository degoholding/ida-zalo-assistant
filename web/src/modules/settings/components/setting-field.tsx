import type { Control, ControllerRenderProps } from 'react-hook-form'
import { useController } from 'react-hook-form'

import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Pill } from '@/shared/ui/pill'
import { Switch } from '@/shared/ui/switch'
import { Textarea } from '@/shared/ui/textarea'
import { getSettingSourceLabel } from '../utils/get-setting-source-label'
import type { SettingFormValues, SettingView } from '../types/setting'

interface SettingFieldProps {
  setting: SettingView
  control: Control<SettingFormValues>
  disabled?: boolean
  /** Có mặt CHỈ khi `source === 'web'` mới hiện nút «Khôi phục mặc định». */
  onRestoreDefault?: () => void
  restorePending?: boolean
}

type FieldValue = ControllerRenderProps<SettingFormValues, string>

function renderInput(setting: SettingView, field: FieldValue, id: string, disabled?: boolean) {
  if (setting.type === 'bool') {
    return (
      <Switch
        id={id}
        checked={Boolean(field.value)}
        onCheckedChange={field.onChange}
        onBlur={field.onBlur}
        disabled={disabled}
      />
    )
  }
  if (setting.type === 'json') {
    return (
      <Textarea
        id={id}
        rows={8}
        className="font-mono text-xs"
        value={(field.value as string) ?? ''}
        onChange={field.onChange}
        onBlur={field.onBlur}
        disabled={disabled}
      />
    )
  }
  if (setting.type === 'int') {
    return (
      <Input
        id={id}
        type="number"
        min={setting.min ?? undefined}
        max={setting.max ?? undefined}
        value={(field.value as string | number) ?? ''}
        onChange={field.onChange}
        onBlur={field.onBlur}
        disabled={disabled}
      />
    )
  }
  // 'string' và 'list' đều là một dòng chữ — khác nhau ở placeholder gợi ý cách nhau dấu phẩy.
  return (
    <Input
      id={id}
      value={(field.value as string) ?? ''}
      onChange={field.onChange}
      onBlur={field.onBlur}
      placeholder={setting.type === 'list' ? 'tên 1, tên 2, …' : undefined}
      disabled={disabled}
    />
  )
}

/** Một ô cài đặt KHÔNG bí mật — chọn kiểu input theo `setting.type`, nhãn nguồn dựng từ `getSettingSourceLabel`. */
export function SettingField({ setting, control, disabled, onRestoreDefault, restorePending }: SettingFieldProps) {
  const { field, fieldState } = useController({ control, name: setting.key })
  const sourceLabel = getSettingSourceLabel(setting)
  const inputId = `setting-${setting.key}`

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>{setting.label}</Label>
      {renderInput(setting, field, inputId, disabled)}
      {fieldState.error && <p className="text-sm text-destructive">{fieldState.error.message}</p>}
      <p className="text-xs text-muted-foreground">{setting.help}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={sourceLabel.isWeb ? 'done' : 'neutral'}>{sourceLabel.text}</Pill>
        {sourceLabel.isWeb && onRestoreDefault && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0"
            disabled={disabled || restorePending}
            onClick={onRestoreDefault}
          >
            Khôi phục mặc định
          </Button>
        )}
      </div>
    </div>
  )
}
