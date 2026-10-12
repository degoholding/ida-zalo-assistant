import { apiGet, httpClient, type SuccessEnvelope } from '@/core/api'
import type { BotHaltStatus } from './bot-halt-types'

export const BOT_HALT_API_PATH = '/api/bot-halt'

export const botHaltApi = {
  getStatus: () => apiGet<BotHaltStatus>(BOT_HALT_API_PATH),
  /** Lấy cả phong bì để toast đúng câu máy chủ nói («Đã tắt bot khẩn» / «Đã bật lại bot»). */
  setHalted: async (halted: boolean) => {
    const res = await httpClient.post<SuccessEnvelope<BotHaltStatus>>(BOT_HALT_API_PATH, { halted })
    return { status: res.data.data, message: res.data.message }
  },
}
