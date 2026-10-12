/** Tình trạng «tắt bot khẩn» như `GET /api/bot-halt` trả về (khớp `BotHaltState` ở `src/messaging/bot-halt-state.ts`). */
export interface BotHaltStatus {
  halted: boolean
  /** ISO 8601 lúc tắt; null khi đang bật */
  since: string | null
  /** Tên người tắt */
  by: string
  via: 'zalo' | 'web' | ''
}
