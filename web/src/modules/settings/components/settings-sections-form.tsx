import { Loader2, RotateCcw, Save } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'

import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader } from '@/shared/ui/card'
import { cn } from '@/shared/utils/cn'
import type { SettingsSection } from '../config/settings-sections'
import { useResetSetting, useSaveSettings } from '../hooks/use-settings'
import { useSettingsForm } from '../hooks/use-settings-form'
import { buildSettingsDefaultValues, toSettingFieldValue } from '../utils/build-settings-default-values'
import { groupSettingsIntoSections } from '../utils/group-settings-into-sections'
import { pickDirtySettings } from '../utils/pick-dirty-settings'
import type { SettingView } from '../types/setting'
import { SecretSettingField } from './secret-setting-field'
import { SettingField } from './setting-field'

interface SettingsSectionsFormProps {
  /** Mọi khóa của tab. */
  settings: SettingView[]
  /** Cách chia thẻ (config/settings-sections.ts). */
  sections: SettingsSection[]
  disabled?: boolean
  /** Phần thêm ở cuối một thẻ, theo id thẻ (vd nút «Kết nối Google», kiểm tra Sheets). */
  extras?: Partial<Record<string, ReactNode>>
}

/**
 * Một tab cài đặt: các thẻ theo chủ đề + thanh Lưu DÍNH ĐÁY (thấy ngay số thay đổi chưa lưu, khỏi cuộn xuống cuối).
 * Một form cho cả tab — Lưu một lần mọi thẻ. Chỉ xử lý thành công (`onSuccess`) CỦA CHÍNH lượt gọi này — tránh dựa vào
 * query toàn cục để khỏi xóa trắng chữ đang gõ dở ở tab khác khi tab này Lưu.
 */
export function SettingsSectionsForm({ settings, sections, disabled, extras }: SettingsSectionsFormProps) {
  const form = useSettingsForm(settings)
  const saveSettings = useSaveSettings()
  const resetSetting = useResetSetting()
  // Đổi key mỗi lần Lưu / Khôi phục / Hoàn tác để `SecretSettingField` tính lại chế độ hiện («Đã đặt» hay ô nhập trống)
  const [version, setVersion] = useState(0)
  const resolved = useMemo(() => groupSettingsIntoSections(sections, settings), [sections, settings])
  const dirtyCount = Object.keys(form.formState.dirtyFields).length

  const onSubmit = form.handleSubmit((values) => {
    const changes = pickDirtySettings(values, form.formState.dirtyFields, settings)
    if (Object.keys(changes).length === 0) return
    saveSettings.mutate(changes, {
      onSuccess: ({ data }) => {
        const updated = data.filter((item) => settings.some((s) => s.key === item.key))
        form.reset(buildSettingsDefaultValues(updated))
        setVersion((v) => v + 1)
      },
    })
  })

  function handleReset(key: string) {
    resetSetting.mutate(key, {
      onSuccess: ({ data }) => {
        const fresh = data.find((item) => item.key === key)
        if (fresh) form.resetField(key, { defaultValue: toSettingFieldValue(fresh) })
        setVersion((v) => v + 1)
      },
    })
  }

  function handleDiscard() {
    form.reset()
    setVersion((v) => v + 1)
  }

  const fieldsDisabled = disabled || saveSettings.isPending

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
      {resolved.map((section) => {
        const Icon = section.icon
        return (
          <Card key={section.id} className="gap-0 py-0">
            <CardHeader className="flex flex-row items-start gap-3 border-b px-5 py-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 space-y-0.5">
                <h3 className="text-sm font-semibold text-navy dark:text-foreground">{section.title}</h3>
                <p className="text-xs text-muted-foreground">{section.description}</p>
              </div>
            </CardHeader>
            <CardContent className="divide-y px-5 py-3">
              {section.settings.map((setting) =>
                setting.secret ? (
                  <SecretSettingField
                    key={`${setting.key}:${version}`}
                    setting={setting}
                    control={form.control}
                    disabled={fieldsDisabled}
                    onDelete={() => handleReset(setting.key)}
                    deletePending={resetSetting.isPending && resetSetting.variables === setting.key}
                  />
                ) : (
                  <SettingField
                    key={setting.key}
                    setting={setting}
                    control={form.control}
                    disabled={fieldsDisabled}
                    onRestoreDefault={() => handleReset(setting.key)}
                    restorePending={resetSetting.isPending && resetSetting.variables === setting.key}
                  />
                ),
              )}
            </CardContent>
            {extras?.[section.id] && <div className="border-t bg-muted/30 px-5 py-4">{extras[section.id]}</div>}
          </Card>
        )
      })}

      <div
        className={cn(
          'sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-sm backdrop-blur',
          dirtyCount > 0 && 'border-primary/40',
        )}
      >
        <p className={cn('text-sm', dirtyCount > 0 ? 'font-medium text-foreground' : 'text-muted-foreground')}>
          {dirtyCount > 0 ? `${dirtyCount} thay đổi chưa lưu` : 'Không có thay đổi chưa lưu'}
        </p>
        <div className="flex items-center gap-2">
          {dirtyCount > 0 && (
            <Button type="button" variant="ghost" size="sm" disabled={saveSettings.isPending} onClick={handleDiscard}>
              <RotateCcw /> Hoàn tác
            </Button>
          )}
          <Button type="submit" size="sm" disabled={fieldsDisabled || !form.formState.isDirty}>
            {saveSettings.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            Lưu thay đổi
          </Button>
        </div>
      </div>
    </form>
  )
}
