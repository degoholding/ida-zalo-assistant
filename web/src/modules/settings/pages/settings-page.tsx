import { Bot, History, RefreshCw } from 'lucide-react'

import { usePermission } from '@/core/authorization/use-permission'
import { AuditTimeline } from '@/shared/audit'
import { Button } from '@/shared/ui/button'
import { ErrorState } from '@/shared/ui/error-state'
import { PageContainer } from '@/shared/ui/page-container'
import { PageHeader } from '@/shared/ui/page-header'
import { Skeleton } from '@/shared/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { GoogleSettingsTab } from '../components/google-settings-tab'
import { SettingsGroupForm } from '../components/settings-group-form'
import { useSettings } from '../hooks/use-settings'

/** Màn Cài đặt — đổi trên web có hiệu lực ngay, không cần khởi động lại (doc 04 mục 7). */
export function SettingsPage() {
  const { data, isLoading, isError, refetch } = useSettings()
  const { can } = usePermission()
  const canWrite = can('setting', 'write')

  return (
    <PageContainer className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Cài đặt"
        description="Sửa ở đây có hiệu lực ngay, không cần khởi động lại. Ô để trống trên web thì dùng giá trị trong .env."
      />

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-9 w-80" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {isError && (
        <ErrorState title="Không tải được cài đặt" description="Có lỗi khi gọi máy chủ, thử tải lại.">
          <Button onClick={() => void refetch()}>Thử lại</Button>
        </ErrorState>
      )}

      {data && (
        <Tabs defaultValue="assistant">
          <TabsList>
            <TabsTrigger value="assistant">
              <Bot /> Trợ lý AI
            </TabsTrigger>
            <TabsTrigger value="sync">
              <RefreshCw /> Đồng bộ Zalo
            </TabsTrigger>
            <TabsTrigger value="google">Google Sheets</TabsTrigger>
            <TabsTrigger value="history">
              <History /> Lịch sử thay đổi
            </TabsTrigger>
          </TabsList>

          <TabsContent value="assistant">
            <SettingsGroupForm
              title="Trợ lý AI"
              icon={Bot}
              settings={data.filter((item) => item.group === 'assistant')}
              disabled={!canWrite}
            />
          </TabsContent>

          <TabsContent value="sync">
            <SettingsGroupForm
              title="Đồng bộ Zalo"
              icon={RefreshCw}
              settings={data.filter((item) => item.group === 'sync')}
              disabled={!canWrite}
            />
          </TabsContent>

          <TabsContent value="google">
            <GoogleSettingsTab settings={data.filter((item) => item.group === 'google')} disabled={!canWrite} />
          </TabsContent>

          <TabsContent value="history">
            <AuditTimeline entity="setting" entityId={1} showMessage />
          </TabsContent>
        </Tabs>
      )}
    </PageContainer>
  )
}
