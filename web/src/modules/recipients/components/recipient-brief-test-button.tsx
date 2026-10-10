import { Loader2, Newspaper } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { useRecipientBriefTest } from '../hooks/use-recipient-brief-test'

/** Loại bản tin nút gọi được — khớp `BriefKind` (`src/constants.ts`) và `BRIEF_TEST_KINDS` (`src/web/api/recipients-api.ts`). */
const BRIEF_TEST_OPTIONS = [
  { kind: 1, label: 'Bản tin sáng' },
  { kind: 2, label: 'Bản tin cuối ngày' },
  { kind: 3, label: 'Báo cáo tuần' },
  { kind: 4, label: 'Báo cáo tháng' },
] as const

/**
 * «Gửi thử bản tin» ở hàng nút dính cạnh «Gửi thử»: menu chọn 1 trong 4 loại, gọi API `brief-test` (trigger WebTest —
 * không chặn bản theo lịch vẫn chạy trong ngày, xem `src/briefs/brief-log-repository.ts`).
 */
export function RecipientBriefTestButton({ recipientId }: { recipientId: number }) {
  const sendBriefTest = useRecipientBriefTest()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={sendBriefTest.isPending}>
          {sendBriefTest.isPending ? <Loader2 className="animate-spin" /> : <Newspaper />}
          Gửi thử bản tin
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {BRIEF_TEST_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.kind}
            disabled={sendBriefTest.isPending}
            onSelect={() => sendBriefTest.mutate({ id: recipientId, kind: option.kind })}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
