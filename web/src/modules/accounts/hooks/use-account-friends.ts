import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { extractErrorMessage } from '@/core/api'
import { queryKeys } from '@/shared/constants/query-keys'
import { accountApi } from '../api/account-api'
import { FRIEND_REQUEST_STATUS, type FriendSearchResult } from '../types/friend-request'

/** Lời mời đến / đã gửi của một tài khoản bot (máy chủ tự đối chiếu với Zalo tối đa mỗi phút một lần). */
export function useFriendOverview(accountId: number) {
  return useQuery({ queryKey: queryKeys.accounts.friends(accountId), queryFn: () => accountApi.friends(accountId) })
}

/** «Làm mới»: hỏi lại Zalo ngay rồi thay danh sách. */
export function useRefreshFriends(accountId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => accountApi.friends(accountId, true),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.accounts.friends(accountId), data),
    onError: (error) => toast.error(extractErrorMessage(error)),
  })
}

/** Tra số điện thoại — chỉ chạy khi đã bấm «Tìm» (`phone` khác null). Không thử lại: tra dồn dập dễ bị Zalo chặn. */
export function useFriendSearch(accountId: number, phone: string | null) {
  return useQuery({
    queryKey: queryKeys.accounts.friendSearch(accountId, phone ?? ''),
    queryFn: () => accountApi.searchFriend(accountId, phone ?? ''),
    enabled: Boolean(phone),
    retry: false,
    staleTime: 60_000,
  })
}

/** Một thao tác kết bạn: báo câu của máy chủ, làm mới danh sách + kết quả tra. */
function useFriendMutation<TInput>(accountId: number, action: (input: TInput) => Promise<string>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: action,
    onSuccess: (message) => {
      toast.success(message)
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts.friends(accountId) })
    },
    onError: (error) => toast.error(extractErrorMessage(error), { duration: 8000 }),
  })
}

export function useSendFriendRequest(accountId: number) {
  const queryClient = useQueryClient()
  return useFriendMutation(accountId, async (payload: { uid: string; message: string; display_name: string; avatar_url: string }) => {
    const { message, status } = await accountApi.sendFriendRequest(accountId, payload)
    // Thẻ kết quả tra đổi trạng thái ngay — không tra lại số trên Zalo
    const relation = status === FRIEND_REQUEST_STATUS.accepted ? 'friend' : 'requested'
    queryClient.setQueriesData<FriendSearchResult>({ queryKey: queryKeys.accounts.friendSearchAll(accountId) }, (old) =>
      old && old.uid === payload.uid ? { ...old, relation } : old)
    return message
  })
}

export function useAcceptFriend(accountId: number) {
  return useFriendMutation(accountId, (uid: string) => accountApi.acceptFriend(accountId, uid))
}

export function useRejectFriend(accountId: number) {
  return useFriendMutation(accountId, (uid: string) => accountApi.rejectFriend(accountId, uid))
}

export function useCancelFriendRequest(accountId: number) {
  return useFriendMutation(accountId, (uid: string) => accountApi.cancelFriendRequest(accountId, uid))
}
