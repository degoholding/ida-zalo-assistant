import { CircleAlert, CircleCheck, ExternalLink, FileSpreadsheet, Loader2, Save } from 'lucide-react'
import { useState } from 'react'

import { extractErrorMessage } from '@/core/api'
import { Button } from '@/shared/ui/button'
import { FormCard } from '@/shared/ui/form-card'
import { useResetSetting, useSaveSettings, useTestGoogleConnection } from '../hooks/use-settings'
import { useSettingsForm } from '../hooks/use-settings-form'
import { buildSettingsDefaultValues, toSettingFieldValue } from '../utils/build-settings-default-values'
import { getGoogleTestAvailability } from '../utils/google-test-availability'
import { pickDirtySettings } from '../utils/pick-dirty-settings'
import type { GoogleTestResult, SettingView } from '../types/setting'
import { SecretSettingField } from './secret-setting-field'
import { SettingField } from './setting-field'

const CONSOLE_URL = 'https://console.cloud.google.com'

// Doc 04 mục 6.1 — 5 bước đại ca / quản trị Google làm TRƯỚC khi dùng được ô dưới đây.
const GUIDE_STEPS = [
  'Vào console.cloud.google.com → chọn hoặc tạo một project (vd "bot-tro-ly").',
  'APIs & Services → Library → tìm "Google Sheets API" → Enable.',
  'IAM & Admin → Service Accounts → Create service account → đặt tên (vd "bot-tro-ly-sheets") → bỏ qua phần cấp quyền → Done.',
  'Mở service account vừa tạo → tab Keys → Add key → Create new key → JSON — tệp .json tự tải về (không gửi qua Zalo / email). Mở bằng Notepad, chép toàn bộ nội dung, dán vào ô "Khóa service account" dưới đây.',
  'Mở Google Sheet muốn bot ghi vào → Chia sẻ → dán email service account (hiện sau khi dán khóa) → quyền "Người chỉnh sửa" → bỏ tick "Thông báo" → Chia sẻ. Chép link trang tính dán vào ô "Link trang tính".',
]

interface GoogleSettingsTabProps {
  settings: SettingView[]
  disabled?: boolean
}

/** Tab Google Sheets: hướng dẫn 5 bước + hai ô cài đặt + nút «Kiểm tra kết nối». */
export function GoogleSettingsTab({ settings, disabled }: GoogleSettingsTabProps) {
  const form = useSettingsForm(settings)
  const saveSettings = useSaveSettings()
  const resetSetting = useResetSetting()
  const testConnection = useTestGoogleConnection()
  const [version, setVersion] = useState(0)
  const [testResult, setTestResult] = useState<GoogleTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const serviceAccount = settings.find((item) => item.key === 'google_service_account_json')
  const spreadsheetUrl = settings.find((item) => item.key === 'google_spreadsheet_url')
  const availability = getGoogleTestAvailability({
    serviceAccountSet: Boolean(serviceAccount?.is_set),
    spreadsheetUrlSet: Boolean(spreadsheetUrl?.is_set),
  })

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

  async function handleTestConnection() {
    setTestResult(null)
    setTestError(null)
    try {
      setTestResult(await testConnection.mutateAsync())
    } catch (error) {
      setTestError(extractErrorMessage(error))
    }
  }

  const fieldsDisabled = disabled || saveSettings.isPending

  return (
    <div className="space-y-4">
      <FormCard title="Hướng dẫn kết nối Google Sheets">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {GUIDE_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <a
          href={CONSOLE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Mở Google Cloud Console <ExternalLink className="size-3.5" />
        </a>
      </FormCard>

      <form onSubmit={(event) => void onSubmit(event)}>
        <FormCard title="Kết nối" icon={FileSpreadsheet}>
          <div className="space-y-5">
            {serviceAccount && (
              <SecretSettingField
                key={`${serviceAccount.key}:${version}`}
                setting={serviceAccount}
                control={form.control}
                disabled={fieldsDisabled}
                onDelete={() => handleReset(serviceAccount.key)}
                deletePending={resetSetting.isPending && resetSetting.variables === serviceAccount.key}
              />
            )}
            {spreadsheetUrl && (
              <SettingField
                setting={spreadsheetUrl}
                control={form.control}
                disabled={fieldsDisabled}
                onRestoreDefault={() => handleReset(spreadsheetUrl.key)}
                restorePending={resetSetting.isPending && resetSetting.variables === spreadsheetUrl.key}
              />
            )}
          </div>
          <Button type="submit" className="mt-5" disabled={fieldsDisabled || !form.formState.isDirty}>
            {saveSettings.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            Lưu
          </Button>
        </FormCard>
      </form>

      <FormCard title="Kiểm tra kết nối">
        <div className="space-y-3">
          <Button
            type="button"
            onClick={() => void handleTestConnection()}
            disabled={disabled || availability.disabled || testConnection.isPending}
          >
            {testConnection.isPending && <Loader2 className="animate-spin" />}
            Kiểm tra kết nối
          </Button>
          {availability.disabled && availability.reason && (
            <p className="text-xs text-muted-foreground">{availability.reason}</p>
          )}
          {testResult && (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <CircleCheck className="size-4" />
              Đã ghi thử vào &quot;{testResult.spreadsheet_title}&quot; › &quot;{testResult.sheet_title}&quot; (
              {testResult.appended_range})
            </p>
          )}
          {testError && (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <CircleAlert className="size-4" />
              {testError}
            </p>
          )}
        </div>
      </FormCard>
    </div>
  )
}
