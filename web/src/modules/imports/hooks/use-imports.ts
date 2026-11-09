import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { getCrudRootKey } from '@/shared/crud/use-crud'
import { importApi } from '../api/import-api'
import type { BatchImportResult, ImportFilesMode, ImportSummary, SeatInfo } from '../types/import'
import { mergeImportSummaries } from '../utils/merge-import-summaries'

const GROUPS_API_PATH = '/api/groups'
/** Ghế đang có người (đã đăng nhập / đang đồng bộ) thì hỏi dày hơn; đang chờ quét QR thì thưa hơn. */
const SEAT_POLL_ACTIVE_MS = 3000
const SEAT_POLL_IDLE_MS = 8000

export function useExportTargets() {
  return useQuery({ queryKey: queryKeys.imports.targets(), queryFn: importApi.targets })
}

/** Trạng thái ghế đồng bộ Zalo PC (phase 14.6). Chưa cấu hình (`configured: false`) thì thôi hỏi lại. */
export function useSeatStatus() {
  return useQuery({
    queryKey: queryKeys.imports.seat(),
    queryFn: importApi.seat,
    refetchInterval: (query) => {
      const info = query.state.data as SeatInfo | undefined
      if (info && !info.configured) return false
      return info?.status?.phase === 'main' ? SEAT_POLL_ACTIVE_MS : SEAT_POLL_IDLE_MS
    },
    retry: false,
  })
}

export function useImportResults() {
  return useQuery({ queryKey: queryKeys.imports.results(), queryFn: importApi.results })
}

export interface ImportZaloWebInput {
  files: File[]
  mode: ImportFilesMode
}

/** Nạp lần lượt từng tệp (mỗi cuộc một tệp); tệp lỗi không chặn các tệp còn lại. */
export function useImportZaloWeb() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ files, mode }: ImportZaloWebInput): Promise<BatchImportResult> => {
      const summaries: ImportSummary[] = []
      const failures: BatchImportResult['failures'] = []
      for (const file of files) {
        try {
          summaries.push((await importApi.zaloWeb(file, mode)).data)
        } catch (error) {
          failures.push({ fileName: file.name, message: extractErrorMessage(error) })
        }
      }
      return { summary: mergeImportSummaries(summaries), files: summaries.length, failures }
    },
    onSuccess: ({ summary, files, failures }) => {
      if (summary) {
        const enriched = summary.enriched ? `, bổ sung ảnh / chữ cho ${summary.enriched} tin đã có` : ''
        toast.success(`Đã nạp ${files} tệp: ${summary.imported} tin mới${enriched} (${summary.duplicates} trùng)`, { duration: 10_000 })
      }
      if (failures.length) toast.error(`${failures.length} tệp lỗi — xem bảng kết quả`, { duration: 10_000 })
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(GROUPS_API_PATH) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports.results() })
    },
    onError: (error) => toast.error(extractErrorMessage(error), { duration: 10_000 }),
  })
}
