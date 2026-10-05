import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { settingApi } from '../api/setting-api'

/** Toàn bộ cài đặt — một mảng duy nhất, mỗi tab tự lọc theo `group`. */
export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings.list(), queryFn: settingApi.list })
}

/** Lưu nhiều khóa một lượt (chỉ khóa đã đổi — xem `pickDirtySettings`). */
export function useSaveSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (changes: Record<string, unknown>) => settingApi.save(changes),
    onSuccess: ({ message }) => {
      toast.success(message)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all })
    },
    onError: (error) => toast.error(extractErrorMessage(error)),
  })
}

/** Khôi phục một khóa về `.env` / mặc định — dùng cho «Khôi phục mặc định» và «Xóa» ô bí mật. */
export function useResetSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => settingApi.reset(key),
    onSuccess: ({ message }) => {
      toast.success(message)
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all })
    },
    onError: (error) => toast.error(extractErrorMessage(error)),
  })
}

/**
 * Nút «Kiểm tra kết nối» — kết quả hiện NGAY DƯỚI NÚT (thành công/lỗi), không
 * qua toast, nên không gắn `onError` ở đây: để component tự đọc `error`.
 */
export function useTestGoogleConnection() {
  return useMutation({ mutationFn: settingApi.testGoogleConnection })
}
