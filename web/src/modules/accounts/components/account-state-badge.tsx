import { Pill } from '@/shared/ui/pill'
import type { StatusTone } from '@/shared/ui/status-tone'
import type { BotAccount } from '../types/account'

/** Màu theo trạng thái gộp máy chủ tính (`state`). */
const STATE_TONE: Record<string, StatusTone> = {
  listening: 'done',
  reconnecting: 'pending',
  stopped: 'pending',
  needs_login: 'danger',
  off: 'neutral',
}

export function AccountStateBadge({ account }: { account: BotAccount }) {
  return <Pill tone={STATE_TONE[account.state] ?? 'neutral'}>{account.state_label}</Pill>
}
