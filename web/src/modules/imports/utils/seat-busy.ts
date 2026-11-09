import type { SeatInfo, SeatJob } from '../types/import'

const RUNNING_STAGES = new Set<SeatJob['stage']>(['sync', 'export', 'import'])

/** Ghế đang bận (điện thoại gửi, xuất, nạp) — đăng xuất lúc này mất dở chừng; không có việc sync-once thì nhìn cờ sync của cổng. */
export function isSeatBusy(info: SeatInfo | undefined): boolean {
  const status = info?.status
  if (!status || status.phase !== 'main') return false
  if (status.job) return RUNNING_STAGES.has(status.job.stage)
  return Boolean(status.sync?.running)
}
