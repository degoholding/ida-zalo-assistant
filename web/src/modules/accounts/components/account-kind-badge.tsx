import { Pill } from '@/shared/ui/pill'
import { BOT_ACCOUNT_KIND, type BotAccount } from '../types/account'

/** Loại tài khoản: "Trợ lý" (như thường) hay "Chỉ thu thập dữ liệu" (không gửi / tác động gì lên Zalo). */
export function AccountKindBadge({ account }: { account: BotAccount }) {
  const collectOnly = account.kind === BOT_ACCOUNT_KIND.normal
  return (
    <span title={collectOnly ? 'Chỉ lưu tin, thành viên, tệp — không trả lời, không gửi, không tác động gì lên Zalo' : 'Trả lời, báo và gửi tin như thường'}>
      <Pill tone={collectOnly ? 'handoff' : 'neutral'}>{collectOnly ? 'Chỉ thu thập dữ liệu' : 'Trợ lý'}</Pill>
    </span>
  )
}
