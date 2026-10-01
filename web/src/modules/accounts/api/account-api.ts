import { apiGet, apiPost } from '@/core/api'
import type { QrLoginState } from '../types/account'

export const ACCOUNTS_API_PATH = '/api/accounts'

export const accountApi = {
  startQrLogin: (label: string) => apiPost<QrLoginState>(`${ACCOUNTS_API_PATH}/qr-login`, { label }),
  getQrLogin: (attemptId: string) => apiGet<QrLoginState>(`${ACCOUNTS_API_PATH}/qr-login/${attemptId}`),
}
