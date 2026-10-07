import type { Control, ControllerRenderProps } from 'react-hook-form'
import { useController } from 'react-hook-form'

import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Pill } from '@/shared/ui/pill'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import { Textarea } from '@/shared/ui/textarea'
import { getSettingSourceLabel } from '../utils/get-setting-source-label'
import { SettingChoiceList } from './setting-choice-list'
import { SettingRow } from './setting-row'
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
  // Chuỗi có lựa chọn sẵn (vd «Nhà cung cấp AI») → chọn một giá trị
  if (setting.type === 'string' && setting.choices?.length) {
    return (
      <Select value={(field.value as string) ?? ''} onValueChange={field.onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full" onBlur={field.onBlur}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {setting.choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (setting.type === 'list' && setting.choices?.length) {
    return (
      <SettingChoiceList id={id} choices={setting.choices} value={field.value} onChange={field.onChange} disabled={disabled} />
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
  const isChoiceList = setting.type === 'list' && Boolean(setting.choices?.length)

  return (
    <SettingRow
      label={setting.label}
      htmlFor={inputId}
      help={setting.help}
      stacked={isChoiceList || setting.type === 'json'}
      alignEnd={setting.type === 'bool'}
      meta={
        <>
          <Pill tone={sourceLabel.isWeb ? 'done' : 'neutral'}>{sourceLabel.text}</Pill>
          {sourceLabel.isWeb && onRestoreDefault && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              disabled={disabled || restorePending}
              onClick={onRestoreDefault}
            >
              Khôi phục mặc định
            </Button>
          )}
        </>
      }
    >
      {renderInput(setting, field, inputId, disabled)}
      {fieldState.error && <p className="mt-1.5 text-sm text-destructive">{fieldState.error.message}</p>}
    </SettingRow>
  )
}
