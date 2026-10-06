import { CalendarClock, ExternalLink, Loader2, Unlink } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { confirm } from '@/shared/ui/confirm-dialog'
import { CopyButton } from '@/shared/ui/copy-button'
import { FormCard } from '@/shared/ui/form-card'
import { Pill } from '@/shared/ui/pill'
import { Skeleton } from '@/shared/ui/skeleton'
import { useDisconnectGoogleOauth, useGoogleOauthStatus, useStartGoogleOauth } from '../hooks/use-google-oauth'

const CONSOLE_URL = 'https://console.cloud.google.com'

// Hướng dẫn 5 bước cho Gmail cá nhân (OAuth người dùng) — khác hẳn 5 bước service
// account của tab Google Sheets phía trên.
const GUIDE_STEPS = [
  'console.cloud.google.com → chọn project (cùng project Sheets cũng được) → APIs & Services → Library → bật "Google Calendar API".',
  'OAuth consent screen → User type "External" → điền tên app, email → Scopes: bỏ qua → Test users: thêm Gmail của anh → Lưu. (Để ở chế độ Testing: cứ 7 ngày phải bấm Kết nối lại.)',
  'Credentials → Create credentials → OAuth client ID → Application type "Web application" → Authorized redirect URIs: dán Redirect URI ở dưới → Create.',
  'Hộp thoại "OAuth client created" hiện ra: bấm nút chép cạnh "Client ID" dán vào ô "Client ID", chép "Client secret" dán vào ô "Client secret" phía trên → Lưu. Không cần tải tệp JSON.',
  'Bấm "Kết nối Google" → đăng nhập Gmail → Cho phép (nếu Google báo "app chưa được xác minh" thì bấm Nâng cao → Tiếp tục).',
]

interface GoogleCalendarConnectCardProps {
  disabled?: boolean
}

/** Thẻ kết nối Google Calendar / Meet (OAuth người dùng) — trợ lý dùng để tạo cuộc họp có Meet. */
export function GoogleCalendarConnectCard({ disabled }: GoogleCalendarConnectCardProps) {
  const { data: status, isLoading } = useGoogleOauthStatus()
  const startOauth = useStartGoogleOauth()
  const disconnectOauth = useDisconnectGoogleOauth()

  async function handleDisconnect() {
    const ok = await confirm({
      title: 'Ngắt kết nối Google',
      message: 'Trợ lý sẽ không tạo được cuộc họp Google Meet nữa cho tới khi kết nối lại.',
      confirmLabel: 'Ngắt kết nối',
    })
    if (ok) disconnectOauth.mutate()
  }

  const clientConfigured = status?.client_configured ?? false
  const connectDisabled = disabled || isLoading || !clientConfigured || startOauth.isPending

  return (
    <FormCard title="Google Calendar & Meet — tạo cuộc họp" icon={CalendarClock}>
      <div className="space-y-4">
        {isLoading && <Skeleton className="h-6 w-56" />}

        {!isLoading && status && (
          <div className="flex flex-wrap items-center gap-2.5">
            {status.connected ? (
              <>
                <Pill tone="done">Đã kết nối: {status.email}</Pill>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || disconnectOauth.isPending}
                  onClick={() => void handleDisconnect()}
                >
                  {disconnectOauth.isPending ? <Loader2 className="animate-spin" /> : <Unlink />}
                  Ngắt kết nối
                </Button>
              </>
            ) : (
              <Pill tone="neutral">Chưa kết nối</Pill>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Button type="button" disabled={connectDisabled} onClick={() => startOauth.mutate()}>
            {startOauth.isPending ? <Loader2 className="animate-spin" /> : <CalendarClock />}
            Kết nối Google
          </Button>
          {!isLoading && !clientConfigured && (
            <p className="text-xs text-muted-foreground">Chép Client ID và Client secret vào hai ô phía trên và Lưu trước.</p>
          )}
        </div>

        {status && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Redirect URI cần khai trong Google Cloud</p>
            <div className="flex items-center gap-1 rounded-md border bg-muted/40 px-2.5 py-1.5">
              <code className="flex-1 truncate font-mono text-xs">{status.redirect_uri}</code>
              <CopyButton value={status.redirect_uri} label="redirect URI" />
            </div>
          </div>
        )}

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

        <p className="text-xs text-muted-foreground">
          Mở trang quản trị bằng đúng địa chỉ của Redirect URI (vd http://localhost:8090) — Google chỉ chấp nhận http
          với localhost.
        </p>
      </div>
    </FormCard>
  )
}
