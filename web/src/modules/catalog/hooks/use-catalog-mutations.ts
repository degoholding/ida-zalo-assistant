import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { getCrudRootKey } from '@/shared/crud/use-crud'
import { catalogApi, CATALOG_API_PATH } from '../api/catalog-api'
import type { CatalogActionRequest } from '../types/catalog'

/** Làm mới cả danh sách lẫn chi tiết (cùng gốc khóa CRUD) sau mọi thao tác ghi, thành công hay bị từ chối (409). */
function useRefreshCatalog() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: getCrudRootKey(CATALOG_API_PATH) })
}

/** Nạp tệp Excel; kết quả tóm tắt do hộp thoại tự hiển thị nên không toast ở đây. */
export function useImportCatalog() {
  const refresh = useRefreshCatalog()
  return useMutation({ mutationFn: (file: File) => catalogApi.importFile(file), onSettled: () => void refresh() })
}

export function useRematchCatalog() {
  const refresh = useRefreshCatalog()
  return useMutation({
    mutationFn: () => catalogApi.rematch(),
    onSuccess: (tally) => toast.success(`Đã khớp lại: ${tally.matched} khớp, ${tally.suggested} gợi ý, ${tally.unmatched} chưa khớp`),
    onSettled: () => void refresh(),
  })
}

/** Chọn liên hệ (`confirm`) hoặc bỏ gắn (`unlink`) cho một mục. */
export function useCatalogMatchAction(entryId: number) {
  const refresh = useRefreshCatalog()
  return useMutation({
    mutationFn: (request: CatalogActionRequest) => catalogApi.runAction(entryId, request),
    onSuccess: (result) => toast.success(result.message || 'Đã cập nhật'),
    onSettled: () => void refresh(),
  })
}
