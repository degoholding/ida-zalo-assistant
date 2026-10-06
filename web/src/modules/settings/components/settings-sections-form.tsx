import type { LucideIcon } from 'lucide-react'
import { Loader2, Save } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/shared/ui/button'
import { FormCard } from '@/shared/ui/form-card'
import { useResetSetting, useSaveSettings } from '../hooks/use-settings'
import { useSettingsForm } from '../hooks/use-settings-form'
import { buildSettingsDefaultValues, toSettingFieldValue } from '../utils/build-settings-default-values'
import { pickDirtySettings } from '../utils/pick-dirty-settings'
import type { SettingView } from '../types/setting'
import { SecretSettingField } from './secret-setting-field'
import { SettingField } from './setting-field'

interface SettingsGroupFormProps {
  title: string
  icon: LucideIcon
  settings: SettingView[]
  disabled?: boolean
}

/**
 * Một tab đơn giản (Trợ lý AI / Đồng bộ Zalo): vẽ hết ô của MỘT nhóm + nút Lưu
 * chung. Chỉ xử lý thành công (`onSuccess`) CỦA CHÍNH lượt gọi này — tránh dựa
 * vào query toàn cục để khỏi xóa trắng chữ đang gõ dở ở tab khác khi tab này Lưu.
 */
export function SettingsGroupForm({ title, icon, settings, disabled }: SettingsGroupFormProps) {
  const form = useSettingsForm(settings)
  const saveSettings = useSaveSettings()
  const resetSetting = useResetSetting()
  // Đổi key mỗi lần Lưu/Reset để `SecretSettingField` tính lại chế độ hiện
  // (tóm tắt «Đã đặt» hay ô nhập trống) đúng theo `is_set` MỚI NHẤT.
  const [version, setVersion] = useState(0)

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

  const fieldsDisabled = disabled || saveSettings.isPending

  return (
    <form onSubmit={(event) => void onSubmit(event)}>
      <FormCard title={title} icon={icon}>
        <div className="space-y-5">
          {settings.map((setting) =>
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
        </div>
        <Button type="submit" className="mt-5" disabled={fieldsDisabled || !form.formState.isDirty}>
          {saveSettings.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          Lưu
        </Button>
      </FormCard>
    </form>
  )
}
