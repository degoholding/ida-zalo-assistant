import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { queryKeys } from '@/shared/constants/query-keys'
import { getCrudRootKey } from '@/shared/crud/use-crud'
import { CONTACTS_API_PATH, contactCardApi } from './contact-card-api'
import type { ContactPatch } from './contact-constants'

export function useContactCard(uid: string | null) {
  return useQuery({
    queryKey: queryKeys.contacts.card(uid ?? ''),
    queryFn: () => contactCardApi.card(uid ?? ''),
    enabled: Boolean(uid),
  })
}

/** Sửa hồ sơ từ cột phải màn Hội thoại. Trang chi tiết Danh bạ đi qua khung CRUD, không dùng hook này. */
export function useUpdateContact(id: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: ContactPatch) => contactCardApi.update(id, patch),
    onSuccess: () => {
      // Danh sách + chi tiết Danh bạ (khóa của khung CRUD), thẻ nổi, cột phải Hội thoại đều có thể đổi theo
      void queryClient.invalidateQueries({ queryKey: getCrudRootKey(CONTACTS_API_PATH) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
      toast.success('Đã lưu hồ sơ')
    },
  })
}
