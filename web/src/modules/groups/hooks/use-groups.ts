import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { getCrudRootKey } from '@/shared/crud/use-crud'
import { groupApi, GROUPS_API_PATH } from '../api/group-api'
import type { BackfillStatus } from '../types/group'

const POLL_MS = 2000

/**
 * «Lấy tin cũ» chạy nền ở máy chủ: bấm là bắt đầu, rồi hỏi tiến độ 2 giây một lần tới khi xong.
 * Xong thì toast câu kết luận và nạp lại nhóm + hội thoại.
 */
export function useBackfillGroup(id: number) {
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: queryKeys.groups.backfill(id),
    queryFn: () => groupApi.backfillStatus(id),
    // 404 = chưa lấy lần nào từ lúc máy chủ khởi động — không phải lỗi
    retry: false,
    refetchInterval: (query) => ((query.state.data as BackfillStatus | undefined)?.running ? POLL_MS : false),
  })
  const start = useMutation({
    mutationFn: (full: boolean) => groupApi.startBackfill(id, full),
    onSuccess: (job) => queryClient.setQueryData(queryKeys.groups.backfill(id), job),
    onError: (error) => toast.error(extractErrorMessage(error), { duration: 8000 }),
  })

  // Báo một lần khi việc vừa chuyển từ đang chạy → xong
  const wasRunning = useRef(false)
  useEffect(() => {
    const job = status.data
    if (!job) return
    if (job.running) {
      wasRunning.current = true
      return
    }
    if (wasRunning.current) {
      wasRunning.current = false
      if (job.error) toast.error(job.message, { duration: 10_000 })
      else toast.success(job.message, { duration: 10_000 })
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(GROUPS_API_PATH) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
    }
  }, [status.data, queryClient])

  return { job: status.data ?? null, start: (full: boolean) => start.mutate(full), isStarting: start.isPending }
}
