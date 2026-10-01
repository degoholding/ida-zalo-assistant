import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { apiDelete, apiGet, httpClient, type SuccessEnvelope } from '@/core/api'
import { appConfig } from '@/core/config/app-config'
import type { ListParams, PaginatedResult } from '@/shared/types/api'
import type { CrudOption } from './types'

/**
 * Khóa cache của lớp CRUD chung. Ba dạng chung một gốc `['crud', apiPath]` để
 * `invalidate` theo gốc quét sạch cả danh sách lẫn chi tiết của cùng apiPath —
 * đừng viết mảng khóa thẳng tại chỗ, lệch một phần tử là invalidate trượt.
 */
export function getCrudRootKey(apiPath: string) {
  return ['crud', apiPath] as const
}

/** Khóa DANH SÁCH — theo tham số lọc/phân trang. */
export function getCrudQueryKey(apiPath: string, params?: Record<string, unknown>) {
  return ['crud', apiPath, params ?? {}] as const
}

/** Khóa CHI TIẾT một bản ghi — chèn `'detail'` để không đụng khóa danh sách. */
export function getCrudDetailKey(apiPath: string, id: string | number | undefined) {
  return ['crud', apiPath, 'detail', id] as const
}

export function useCrudList<T>(apiPath: string, params: ListParams = {}) {
  const query: ListParams = {
    page: 1,
    page_size: appConfig.defaultPageSize,
    ...params,
  }

  return useQuery({
    queryKey: getCrudQueryKey(apiPath, query),
    queryFn: () => apiGet<PaginatedResult<T>>(apiPath, { params: query }),
    placeholderData: keepPreviousData,
  })
}

export function useCrudDetail<T>(apiPath: string, id: string | number | undefined) {
  return useQuery({
    queryKey: getCrudDetailKey(apiPath, id),
    queryFn: () => apiGet<T>(`${apiPath}/${id}`),
    enabled: Boolean(id && id !== '0' && id !== 'new'),
  })
}

export function useCrudSave<T, TValues extends Record<string, unknown> = Record<string, unknown>>(
  apiPath: string,
  title: string,
) {
  const queryClient = useQueryClient()

  return useMutation({
    //  Bot trợ lý: máy chủ gửi câu nhắc có nghĩa trong `message` (vd «Đã bật đọc; lấy được 37 tin cũ»)
    //  nên lấy phong bì đầy đủ, toast câu đó; không có thì dùng câu chung.
    mutationFn: async ({ id, values }: { id?: string | number; values: TValues }) => {
      const res = id
        ? await httpClient.patch<SuccessEnvelope<T>>(`${apiPath}/${id}`, values)
        : await httpClient.post<SuccessEnvelope<T>>(apiPath, values)
      return { data: res.data.data, message: res.data.message }
    },

    onSuccess: (result, variables) => {
      toast.success(result.message || (variables.id ? `Đã cập nhật ${title.toLowerCase()}` : `Đã thêm ${title.toLowerCase()}`))
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(apiPath) })
    },
  })
}

export function useCrudDelete(apiPath: string, title: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string | number) => apiDelete(`${apiPath}/${id}`),
    onSuccess: () => {
      toast.success(`Đã xóa ${title.toLowerCase()}`)
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(apiPath) })
    },
  })
}

/** Nạp danh sách options động từ API cho ô select (vd `/api/departments`) */
export function useCrudSourceOptions(source?: { url: string; valueKey?: string; labelKey?: string }) {
  const url = source?.url
  const valueKey = source?.valueKey || 'id'
  const labelKey = source?.labelKey || 'name'

  return useQuery({
    queryKey: ['crud-source', url],
    queryFn: async () => {
      if (!url) return []
      const res = await apiGet<unknown>(url, { params: { page_size: 1000 } })
      let items: Record<string, unknown>[] = []
      if (Array.isArray(res)) {
        items = res
      } else if (res && typeof res === 'object' && 'items' in res) {
        const inner = (res as { items: unknown }).items
        if (Array.isArray(inner)) items = inner
      }
      return items.map((item) => ({
        value: String(item[valueKey] ?? ''),
        label: String(item[labelKey] ?? item[valueKey] ?? ''),
      })) as CrudOption[]
    },
    enabled: Boolean(url),
    staleTime: 5 * 60 * 1000, // 5 phút
  })
}
