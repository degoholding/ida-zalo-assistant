import { apiGet, apiPost, httpClient, type SuccessEnvelope } from '@/core/api'
import type { QrLoginState } from '../types/account'
import type { FriendOverview, FriendSearchResult } from '../types/friend-request'

export const ACCOUNTS_API_PATH = '/api/accounts'

/** POST rồi lấy luôn câu của máy chủ cho toast («Đã gửi lời mời kết bạn»…). */
async function postWithMessage(url: string, body?: unknown): Promise<string> {
  const res = await httpClient.post<SuccessEnvelope<unknown>>(url, body)
  return res.data.message ?? 'Đã xong'
}

export const accountApi = {
  startQrLogin: (label: string) => apiPost<QrLoginState>(`${ACCOUNTS_API_PATH}/qr-login`, { label }),
  getQrLogin: (attemptId: string) => apiGet<QrLoginState>(`${ACCOUNTS_API_PATH}/qr-login/${attemptId}`),
  /** Tab Kết bạn: lời mời đến / đã gửi. `refresh` = hỏi lại Zalo ngay (nút Làm mới). */
  friends: (id: number, refresh = false) =>
    apiGet<FriendOverview>(`${ACCOUNTS_API_PATH}/${id}/friends`, { params: refresh ? { refresh: 1 } : {} }),
  searchFriend: (id: number, phone: string) => apiGet<FriendSearchResult>(`${ACCOUNTS_API_PATH}/${id}/friends/search`, { params: { phone } }),
  /** Bot mời kết bạn — `status` = FRIEND_REQUEST_STATUS (đã là bạn sẵn thì «accepted» luôn). */
  sendFriendRequest: async (id: number, payload: { uid: string; message: string; display_name: string; avatar_url: string }) => {
    const res = await httpClient.post<SuccessEnvelope<{ status: number; sent_today: number; daily_cap: number }>>(
      `${ACCOUNTS_API_PATH}/${id}/friends/requests`, payload)
    return { message: res.data.message ?? 'Đã gửi lời mời kết bạn', status: res.data.data.status }
  },
  acceptFriend: (id: number, uid: string) => postWithMessage(`${ACCOUNTS_API_PATH}/${id}/friends/incoming/${encodeURIComponent(uid)}/accept`),
  rejectFriend: (id: number, uid: string) => postWithMessage(`${ACCOUNTS_API_PATH}/${id}/friends/incoming/${encodeURIComponent(uid)}/reject`),
  cancelFriendRequest: (id: number, uid: string) => postWithMessage(`${ACCOUNTS_API_PATH}/${id}/friends/requests/${encodeURIComponent(uid)}/cancel`),
}
