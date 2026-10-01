import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { getCrudRootKey } from '@/shared/crud/use-crud'
import { fileApi, FILES_API_PATH } from '../api/file-api'

export function useRetryFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => fileApi.retry(id),
    onSuccess: ({ message }) => {
      toast.success(message)
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(FILES_API_PATH) })
    },
    onError: (error) => toast.error(extractErrorMessage(error)),
  })
}

/** «Đọc»: bóc chữ của tệp (xlsx / docx tức thì; pdf / ảnh vài giây vì nhờ mô hình). */
export function useExtractFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => fileApi.extract(id),
    onSuccess: ({ message, data }) => {
      toast.success(message, { duration: 6000 })
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(FILES_API_PATH) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.files.text(data.id) })
    },
    onError: (error) => toast.error(extractErrorMessage(error), { duration: 8000 }),
  })
}

export function useFileText(id: number | null) {
  return useQuery({ queryKey: queryKeys.files.text(id ?? 0), queryFn: () => fileApi.text(id ?? 0), enabled: Boolean(id), retry: false })
}
