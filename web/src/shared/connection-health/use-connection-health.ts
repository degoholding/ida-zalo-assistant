import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { usePermission } from '@/core/authorization/use-permission'
import { queryKeys } from '@/shared/constants/query-keys'
import { connectionHealthApi } from './connection-health-api'
import { assessConnectionHealth, type ConnectionHealth } from './connection-health'

const POLL_INTERVAL_MS = 60_000

/**
 * Trạng thái Google + phiên Zalo cho chấm ở menu và dải cảnh báo — CHỈ người có quyền cài đặt (người khác: `allowed`
 * false, không gọi API, không vẽ gì). Đọc 60 giây / lần; lỗi mạng giữ giá trị cũ.
 */
export function useConnectionHealth(): { allowed: boolean; health: ConnectionHealth | null } {
  const { can } = usePermission()
  const allowed = can('setting', 'write')
  const google = useQuery({
    queryKey: queryKeys.googleOauth.status(),
    queryFn: connectionHealthApi.googleStatus,
    enabled: allowed,
    refetchInterval: POLL_INTERVAL_MS,
  })
  const accounts = useQuery({
    queryKey: queryKeys.connectionHealth.accounts(),
    queryFn: connectionHealthApi.accounts,
    enabled: allowed,
    refetchInterval: POLL_INTERVAL_MS,
  })
  if (!allowed) return { allowed: false, health: null }
  // Chưa có cả hai (lần tải đầu) thì chưa chấm — khỏi nhá đỏ / xanh sai
  if (google.data === undefined && accounts.data === undefined) return { allowed: true, health: null }
  return { allowed: true, health: assessConnectionHealth(google.data, accounts.data) }
}

/** Bấm chấm Google / nút trên dải: đúng luồng của Cài đặt → Google (xin auth_url rồi sang Google, về lại /app/settings). */
export function useStartGoogleOauthFromMenu() {
  return useMutation({
    mutationFn: connectionHealthApi.startGoogleOauth,
    onSuccess: ({ auth_url }) => {
      window.location.assign(auth_url)
    },
    onError: (error) => toast.error(extractErrorMessage(error)),
  })
}
