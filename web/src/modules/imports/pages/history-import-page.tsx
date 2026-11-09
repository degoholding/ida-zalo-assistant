import { PageContainer } from '@/shared/ui/page-container'
import { PageHeader } from '@/shared/ui/page-header'
import { ImportResultsCard } from '../components/import-results-card'
import { SeatSyncCard } from '../components/seat-sync-card'
import { useSeatStatus } from '../hooks/use-imports'
import { isSeatBusy } from '../utils/seat-busy'

/** Nhập lịch sử = ghế đồng bộ Zalo PC (phase 14): quét QR, điện thoại gửi toàn bộ lịch sử, ghế nạp vào kho rồi đăng xuất. */
export function HistoryImportPage() {
  const seat = useSeatStatus()
  return (
    <PageContainer className="mx-auto w-full max-w-4xl">
      <PageHeader title="Nhập lịch sử" description="Quét QR bằng Zalo trên điện thoại, bấm Đồng ý, toàn bộ tin cũ về kho bot." />
      <SeatSyncCard />
      <ImportResultsCard active={isSeatBusy(seat.data)} />
    </PageContainer>
  )
}
