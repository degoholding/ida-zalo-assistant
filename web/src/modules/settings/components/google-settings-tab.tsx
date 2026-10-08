import { CircleAlert, CircleCheck, Loader2, PlugZap } from 'lucide-react'
import { useState } from 'react'

import { extractErrorMessage } from '@/core/api'
import { Button } from '@/shared/ui/button'
import { GOOGLE_SECTIONS } from '../config/settings-sections'
import { useTestGoogleConnection } from '../hooks/use-settings'
import { getGoogleTestAvailability } from '../utils/google-test-availability'
import type { GoogleTestResult, SettingView } from '../types/setting'
import { GoogleCalendarConnectPanel } from './google-calendar-connect-panel'
import { SettingGuideDetails } from './setting-guide-details'
import { SettingsSectionsForm } from './settings-sections-form'

// Doc 04 mục 6.1 — 5 bước đại ca / quản trị Google làm TRƯỚC khi dùng được ô Google Sheets.
const SHEETS_GUIDE_STEPS = [
  'Vào console.cloud.google.com → chọn hoặc tạo một project (vd "bot-tro-ly").',
  'APIs & Services → Library → tìm "Google Sheets API" → Enable.',
  'IAM & Admin → Service Accounts → Create service account → đặt tên (vd "bot-tro-ly-sheets") → bỏ qua phần cấp quyền → Done.',
  'Mở service account vừa tạo → tab Keys → Add key → Create new key → JSON — tệp .json tự tải về (không gửi qua Zalo / email). Mở bằng Notepad, chép toàn bộ nội dung, dán vào ô "Khóa service account" phía trên.',
  'Mở Google Sheet muốn bot ghi vào → Chia sẻ → dán email service account (hiện sau khi dán khóa) → quyền "Người chỉnh sửa" → bỏ tick "Thông báo" → Chia sẻ. Chép link trang tính dán vào ô "Link trang tính".',
]

interface GoogleSheetsTestPanelProps {
  settings: SettingView[]
  disabled?: boolean
}

/** Cuối thẻ Google Sheets: nút «Kiểm tra kết nối» (ghi thử một dòng) + hướng dẫn thu gọn. */
function GoogleSheetsTestPanel({ settings, disabled }: GoogleSheetsTestPanelProps) {
  const testConnection = useTestGoogleConnection()
  const [testResult, setTestResult] = useState<GoogleTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const availability = getGoogleTestAvailability({
    serviceAccountSet: Boolean(settings.find((item) => item.key === 'google_service_account_json')?.is_set),
    spreadsheetUrlSet: Boolean(settings.find((item) => item.key === 'google_spreadsheet_url')?.is_set),
  })

  async function handleTestConnection() {
    setTestResult(null)
    setTestError(null)
    try {
      setTestResult(await testConnection.mutateAsync())
    } catch (error) {
      setTestError(extractErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleTestConnection()}
          disabled={disabled || availability.disabled || testConnection.isPending}
        >
          {testConnection.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
          Kiểm tra Google Sheets
        </Button>
        {availability.disabled && availability.reason && (
          <p className="text-xs text-muted-foreground">{availability.reason}</p>
        )}
      </div>
      {testResult && (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <CircleCheck className="size-4 shrink-0" />
          Đã ghi thử vào &quot;{testResult.spreadsheet_title}&quot; › &quot;{testResult.sheet_title}&quot; (
          {testResult.appended_range})
        </p>
      )}
      {testError && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <CircleAlert className="size-4 shrink-0" />
          {testError}
        </p>
      )}
      <SettingGuideDetails title="Hướng dẫn kết nối Google Sheets (5 bước)" steps={SHEETS_GUIDE_STEPS} />
    </div>
  )
}

interface GoogleSettingsTabProps {
  settings: SettingView[]
  disabled?: boolean
}

/**
 * Tab Google: ba thẻ tách bạch — Đăng nhập Google (Client ID cho nút đăng nhập web), Google Sheets (service account,
 * xuất báo cáo) và Google Calendar & Meet (OAuth, tạo cuộc họp). Mỗi thẻ: ô cài đặt của mình + phần kiểm tra / kết nối ngay bên dưới; Lưu chung một thanh dính đáy.
 */
export function GoogleSettingsTab({ settings, disabled }: GoogleSettingsTabProps) {
  return (
    <SettingsSectionsForm
      settings={settings}
      sections={GOOGLE_SECTIONS}
      disabled={disabled}
      extras={{
        sheets: <GoogleSheetsTestPanel settings={settings} disabled={disabled} />,
        calendar: <GoogleCalendarConnectPanel disabled={disabled} />,
      }}
    />
  )
}
