import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { googleOauthApi } from '../api/google-oauth-api'

/** Trạng thái kết nối Google Calendar / Meet — nguồn sự thật cho thẻ kết nối. */
export function useGoogleOauthStatus() {
  return useQuery({ queryKey: queryKeys.googleOauth.status(), queryFn: googleOauthApi.status })
}

/**
 * Bấm «Kết nối Google»: xin `auth_url` rồi điều hướng CẢ TRÌNH DUYỆT sang Google
 * (`window.location.assign`, không phải điều hướng trong app) — Google xác thực
 * xong tự đưa trình duyệt về lại `/app/settings`.
 */
export function useStartGoogleOauth() {
  return useMutation({
    mutationFn: googleOauthApi.start,
    onSuccess: ({ auth_url }) => {
      window.location.assign(auth_url)
    },
    onError: (error) => toast.error(extractErrorMessage(error)),
  })
}

/** Ngắt kết nối — mất quyền tạo cuộc họp Meet tới khi kết nối lại. */
export function useDisconnectGoogleOauth() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: googleOauthApi.disconnect,
    onSuccess: () => {
      toast.success('Đã ngắt kết nối Google')
      void queryClient.invalidateQueries({ queryKey: queryKeys.googleOauth.all })
    },
    onError: (error) => toast.error(extractErrorMessage(error)),
  })
}
