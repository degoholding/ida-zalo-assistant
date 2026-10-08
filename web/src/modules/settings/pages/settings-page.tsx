import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { usePermission } from '@/core/authorization/use-permission'
import { AuditTimeline } from '@/shared/audit'
import { Button } from '@/shared/ui/button'
import { ErrorState } from '@/shared/ui/error-state'
import { PageContainer } from '@/shared/ui/page-container'
import { PageHeader } from '@/shared/ui/page-header'
import { Skeleton } from '@/shared/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { AiKeysTab } from '../components/ai-keys-tab'
import { AssistantSettingsTab } from '../components/assistant-settings-tab'
import { GoogleSettingsTab } from '../components/google-settings-tab'
import { ScheduleStatusCard } from '../components/schedule-status-card'
import { SettingsSectionsForm } from '../components/settings-sections-form'
import { OPERATIONS_SECTIONS, SETTINGS_TABS, SYNC_SECTIONS, type SettingsTabId } from '../config/settings-sections'
import { useGoogleOauthRedirectToast } from '../hooks/use-google-oauth-redirect-toast'
import { useSettings } from '../hooks/use-settings'

function resolveInitialTab(requested: string | null): SettingsTabId {
  return SETTINGS_TABS.find((tab) => tab.id === requested)?.id ?? 'ai-keys'
}

/**
 * Màn Cài đặt — đổi trên web có hiệu lực ngay, không cần khởi động lại (doc 04 mục 7). Tab NGANG kiểu gạch chân (đại ca
 * chê tab dọc 06/10/2026): rãnh xám `bg-muted` của TabsList trùng màu nền trang nên dải phân đoạn trông rời rạc — xem
 * `shared/ui/tab-underline.ts`; đường kẻ chân trải hết bề ngang làm neo, vạch màu chính chỉ tab đang mở.
 */
export function SettingsPage() {
  const { data, isLoading, isError, refetch } = useSettings()
  const { can } = usePermission()
  const canWrite = can('setting', 'write')
  const [searchParams] = useSearchParams()
  // Google xác thực xong đưa trình duyệt về `?tab=google&google_oauth=...` — mở thẳng tab đó.
  const [tab, setTab] = useState<SettingsTabId>(() => resolveInitialTab(searchParams.get('tab')))
  useGoogleOauthRedirectToast()

  return (
    <PageContainer className="mx-auto w-full max-w-5xl">
      <PageHeader
        title="Cài đặt"
        description="Sửa ở đây có hiệu lực ngay, không cần khởi động lại. Ô để trống trên web thì dùng giá trị trong .env."
      />

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      )}

      {isError && (
        <ErrorState title="Không tải được cài đặt" description="Có lỗi khi gọi máy chủ, thử tải lại.">
          <Button onClick={() => void refetch()}>Thử lại</Button>
        </ErrorState>
      )}

      {data && (
        <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTabId)} className="gap-5">
          <TabsList className="h-auto w-full justify-start gap-6 overflow-x-auto rounded-none border-b bg-transparent p-0">
            {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
              <TabsTrigger
                key={id}
                value={id}
                className="-mb-px h-10 flex-none rounded-none border-0 border-b-2 border-transparent px-1 text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <Icon /> {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="ai-keys" className="mt-0">
            <AiKeysTab />
          </TabsContent>

          <TabsContent value="assistant" className="mt-0">
            <AssistantSettingsTab settings={data.filter((item) => item.group === 'assistant')} disabled={!canWrite} />
          </TabsContent>

          <TabsContent value="sync" className="mt-0">
            <SettingsSectionsForm
              settings={data.filter((item) => item.group === 'sync')}
              sections={SYNC_SECTIONS}
              disabled={!canWrite}
            />
          </TabsContent>

          <TabsContent value="operations" className="mt-0 space-y-4">
            <SettingsSectionsForm
              settings={data.filter((item) => item.group === 'operations')}
              sections={OPERATIONS_SECTIONS}
              disabled={!canWrite}
            />
            <ScheduleStatusCard />
          </TabsContent>

          <TabsContent value="google" className="mt-0">
            <GoogleSettingsTab settings={data.filter((item) => item.group === 'google')} disabled={!canWrite} />
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <AuditTimeline entity="setting" entityId={1} showMessage />
          </TabsContent>
        </Tabs>
      )}
    </PageContainer>
  )
}
