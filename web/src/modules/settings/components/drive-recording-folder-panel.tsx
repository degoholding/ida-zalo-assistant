import { CircleAlert, CircleCheck, Loader2, Mic } from 'lucide-react'
import { useState } from 'react'

import { extractErrorMessage } from '@/core/api'
import { Button } from '@/shared/ui/button'
import { Pill } from '@/shared/ui/pill'
import { Skeleton } from '@/shared/ui/skeleton'
import { useGoogleOauthStatus } from '../hooks/use-google-oauth'
import { useTestDriveFolder } from '../hooks/use-settings'
import { getDriveTestAvailability } from '../utils/drive-test-availability'
import type { DriveTestResult, SettingView } from '../types/setting'
import { SettingGuideDetails } from './setting-guide-details'

// Khác hẳn 5 bước service account của Google Sheets: thư mục «Ghi âm họp» nằm SẴN trong Drive của chính
// Gmail đã «Kết nối Google» (mục Calendar & Meet phía trên) — không có bước chia sẻ thư mục cho ai cả.
const GUIDE_STEPS = [
  'console.cloud.google.com → project của Client ID (mục Calendar & Meet) → APIs & Services → Library → tìm "Google Drive API" → Enable.',
  'OAuth consent screen → bấm "Publish App" nếu app đang ở chế độ Testing (tránh phải kết nối lại Google mỗi 7 ngày).',
  'Mở Drive của Gmail đã kết nối → tạo (hoặc chọn) một thư mục, vd "Ghi âm họp" → người họp tải tệp mp3 vào đây sau mỗi cuộc họp.',
  'Chép link thư mục đó, dán vào ô "Thư mục ghi âm họp (Drive)" phía trên → Lưu. Rồi bấm "Kết nối lại" ở mục Calendar & Meet để Google hỏi thêm quyền đọc Drive (chỉ xem) → đồng ý.',
]

interface DriveRecordingFolderPanelProps {
  settings: SettingView[]
  disabled?: boolean
}

/** Cuối thẻ «Recap họp tự động»: trạng thái quyền Drive + nút «Kiểm tra thư mục» + hướng dẫn thu gọn. */
export function DriveRecordingFolderPanel({ settings, disabled }: DriveRecordingFolderPanelProps) {
  const { data: status, isLoading } = useGoogleOauthStatus()
  const testFolder = useTestDriveFolder()
  const [testResult, setTestResult] = useState<DriveTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const availability = getDriveTestAvailability({
    connected: status?.connected ?? false,
    driveScopeGranted: status?.drive_scope_granted ?? false,
    folderSet: Boolean(settings.find((item) => item.key === 'google_drive_recording_folder')?.is_set),
  })

  async function handleTest() {
    setTestResult(null)
    setTestError(null)
    try {
      setTestResult(await testFolder.mutateAsync())
    } catch (error) {
      setTestError(extractErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        {isLoading && <Skeleton className="h-6 w-56" />}
        {!isLoading && status && (
          <Pill tone={status.drive_scope_granted ? 'done' : 'neutral'}>
            {status.drive_scope_granted ? `Đã có quyền đọc Drive: ${status.email}` : 'Chưa có quyền đọc Drive'}
          </Pill>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleTest()}
          disabled={disabled || availability.disabled || testFolder.isPending}
        >
          {testFolder.isPending ? <Loader2 className="animate-spin" /> : <Mic />}
          Kiểm tra thư mục
        </Button>
        {availability.disabled && availability.reason && (
          <p className="text-xs text-muted-foreground">{availability.reason}</p>
        )}
      </div>
      {testResult && (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <CircleCheck className="size-4 shrink-0" />
          Thấy thư mục &quot;{testResult.folder_name}&quot; — {testResult.audio_files_7d} ghi âm trong 7 ngày
        </p>
      )}
      {testError && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <CircleAlert className="size-4 shrink-0" />
          {testError}
        </p>
      )}
      <SettingGuideDetails title="Hướng dẫn bật recap họp tự động (4 bước)" steps={GUIDE_STEPS} />
    </div>
  )
}
