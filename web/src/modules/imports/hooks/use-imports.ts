import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { getCrudRootKey } from '@/shared/crud/use-crud'
import { importApi } from '../api/import-api'
import type { BatchImportResult, ImportSummary } from '../types/import'
import { mergeImportSummaries } from '../utils/merge-import-summaries'

const GROUPS_API_PATH = '/api/groups'

export function useExportTargets() {
  return useQuery({ queryKey: queryKeys.imports.targets(), queryFn: importApi.targets })
}

/** Nạp lần lượt từng tệp (mỗi nhóm một tệp); tệp lỗi không chặn các tệp còn lại. */
export function useImportZaloWeb() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (files: File[]): Promise<BatchImportResult> => {
      const summaries: ImportSummary[] = []
      const failures: BatchImportResult['failures'] = []
      for (const file of files) {
        try {
          summaries.push((await importApi.zaloWeb(file)).data)
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
    },
    onError: (error) => toast.error(extractErrorMessage(error), { duration: 10_000 }),
  })
}
