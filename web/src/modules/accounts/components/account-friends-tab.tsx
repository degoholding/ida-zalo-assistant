import { Check, Info, Loader2, RefreshCw, Search, Send, TriangleAlert, Undo2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { extractErrorMessage } from '@/core/api'
import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { appRoutes } from '@/shared/constants/app-routes'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Pill } from '@/shared/ui/pill'
import type { StatusTone } from '@/shared/ui/status-tone'
import { Textarea } from '@/shared/ui/textarea'
import { formatDateTime } from '@/shared/utils/format-date'
import {
  useAcceptFriend,
  useCancelFriendRequest,
  useFriendOverview,
  useFriendSearch,
  useRefreshFriends,
  useRejectFriend,
  useSendFriendRequest,
} from '../hooks/use-account-friends'
import type { BotAccountDetail } from '../types/account'
import {
  FRIEND_RELATION_LABELS,
  FRIEND_REQUEST_STATUS,
  FRIEND_REQUEST_STATUS_LABELS,
  type FriendOverview,
  type FriendRequestRecord,
} from '../types/friend-request'

const STATUS_TONE: Record<number, StatusTone> = {
  [FRIEND_REQUEST_STATUS.pending]: 'pending',
  [FRIEND_REQUEST_STATUS.accepted]: 'done',
  [FRIEND_REQUEST_STATUS.rejected]: 'danger',
  [FRIEND_REQUEST_STATUS.cancelled]: 'neutral',
}

/** Ảnh Zalo nằm trên máy chủ ảnh của Zalo — trang chặn ảnh ngoài (CSP), chỉ dùng ảnh đã cất trong kho của bot. */
const localAvatar = (url: string | null | undefined) => (url && url.startsWith('/') ? url : null)

function FriendHelp() {
  return (
    <Card className="flex-row gap-3 p-4 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-info" />
      <div className="space-y-1">
        <p className="font-medium">Đưa bot vào nhóm Zalo để bot đọc tin</p>
        <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
          <li>Kết bạn với bot: tìm số điện thoại bên dưới rồi «Gửi lời mời», hoặc người đó tự mời bot rồi bấm «Đồng ý» ở mục Lời mời đến.</li>
          <li>Kết bạn xong, người đó vào nhóm Zalo → «Thêm thành viên» → chọn bot.</li>
          <li>
            Bật «Đọc tin» cho nhóm ở màn <Link to={appRoutes.groups.list} className="text-primary hover:underline">Nhóm</Link> (hoặc chuyển nhóm sang Nội bộ).
          </li>
        </ol>
      </div>
    </Card>
  )
}

function PersonCell({ name, uid, avatarUrl, note }: { name: string; uid: string; avatarUrl: string | null; note?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <EntityAvatar name={name || uid} avatarUrl={localAvatar(avatarUrl)} />
      <div className="min-w-0">
        <div className="truncate font-medium">{name || 'Chưa rõ tên'}</div>
        <div className="truncate text-xs text-muted-foreground" title={note || uid}>{note || uid}</div>
      </div>
    </div>
  )
}

function FriendSearchCard({ accountId, overview }: { accountId: number; overview: FriendOverview }) {
  const [phoneInput, setPhoneInput] = useState('')
  const [submittedPhone, setSubmittedPhone] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const search = useFriendSearch(accountId, submittedPhone)
  const send = useSendFriendRequest(accountId)
  const result = search.data
  const messageValue = message ?? overview.default_message
  const capReached = overview.sent_today >= overview.daily_cap

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const phone = phoneInput.trim()
    if (phone) setSubmittedPhone(phone)
  }

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">Tìm theo số điện thoại</h3>
        <span className="text-xs text-muted-foreground">Hôm nay bot đã gửi {overview.sent_today}/{overview.daily_cap} lời mời</span>
      </div>
      <form className="flex gap-2" onSubmit={handleSubmit}>
        <Input
          aria-label="Số điện thoại"
          inputMode="tel"
          maxLength={20}
          placeholder="Vd 0912 345 678"
          value={phoneInput}
          onChange={(event) => setPhoneInput(event.target.value)}
          disabled={!overview.running}
          className="max-w-xs"
        />
        <Button type="submit" variant="outline" disabled={!overview.running || !phoneInput.trim() || search.isFetching}>
          {search.isFetching ? <Loader2 className="animate-spin" /> : <Search />}
          Tìm
        </Button>
      </form>
      {search.isError && <p className="text-sm text-destructive">{extractErrorMessage(search.error)}</p>}
      {result && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <PersonCell name={result.display_name} uid={result.uid} avatarUrl={result.avatar_url} note={result.zalo_name ? `Tên Zalo: ${result.zalo_name}` : undefined} />
            <Pill tone={result.relation === 'none' ? 'neutral' : result.relation === 'friend' ? 'done' : 'pending'}>{FRIEND_RELATION_LABELS[result.relation]}</Pill>
          </div>
          {result.relation === 'none' && (
            <>
              <Textarea
                aria-label="Lời nhắn kèm lời mời"
                value={messageValue}
                maxLength={overview.max_message_length}
                onChange={(event) => setMessage(event.target.value)}
                rows={2}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {capReached ? 'Đã đủ số lời mời hôm nay — mai gửi tiếp để Zalo không khóa tài khoản bot.' : `${messageValue.length}/${overview.max_message_length} ký tự`}
                </span>
                <Button
                  disabled={send.isPending || capReached || !overview.running}
                  onClick={() => send.mutate({ uid: result.uid, message: messageValue.trim(), display_name: result.display_name, avatar_url: result.avatar_url })}
                >
                  {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                  Gửi lời mời
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}

function IncomingCard({ accountId, overview }: { accountId: number; overview: FriendOverview }) {
  const accept = useAcceptFriend(accountId)
  const reject = useRejectFriend(accountId)
  const busyUid = accept.isPending ? accept.variables : reject.isPending ? reject.variables : null
  return (
    <Card className="gap-0 p-0">
      <h3 className="border-b px-4 py-3 font-semibold">Lời mời đến <span className="font-normal text-muted-foreground">({overview.incoming.length})</span></h3>
      {!overview.incoming.length && <p className="p-4 text-sm text-muted-foreground">Không có ai đang mời bot kết bạn.</p>}
      <ul className="divide-y">
        {overview.incoming.map((request) => (
          <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <PersonCell name={request.display_name} uid={request.zalo_uid} avatarUrl={request.avatar_url} note={request.message || formatDateTime(request.requested_at)} />
            <div className="flex gap-2">
              <Button size="sm" disabled={!overview.running || busyUid !== null} onClick={() => accept.mutate(request.zalo_uid)} aria-label={`Đồng ý ${request.display_name || request.zalo_uid}`}>
                {busyUid === request.zalo_uid && accept.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                Đồng ý
              </Button>
              <Button size="sm" variant="outline" disabled={!overview.running || busyUid !== null} onClick={() => reject.mutate(request.zalo_uid)} aria-label={`Từ chối ${request.display_name || request.zalo_uid}`}>
                {busyUid === request.zalo_uid && reject.isPending ? <Loader2 className="animate-spin" /> : <X />}
                Từ chối
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function SentCard({ accountId, overview }: { accountId: number; overview: FriendOverview }) {
  const cancel = useCancelFriendRequest(accountId)
  return (
    <Card className="gap-0 p-0">
      <h3 className="border-b px-4 py-3 font-semibold">Lời mời đã gửi <span className="font-normal text-muted-foreground">({overview.sent.length})</span></h3>
      {!overview.sent.length && <p className="p-4 text-sm text-muted-foreground">Bot chưa gửi lời mời nào.</p>}
      <ul className="divide-y">
        {overview.sent.map((request: FriendRequestRecord) => (
          <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <PersonCell name={request.display_name} uid={request.zalo_uid} avatarUrl={request.avatar_url} note={`Gửi lúc ${formatDateTime(request.requested_at)}`} />
            <div className="flex items-center gap-2">
              <Pill tone={STATUS_TONE[request.status] ?? 'neutral'}>{FRIEND_REQUEST_STATUS_LABELS[request.status] ?? `Trạng thái ${request.status}`}</Pill>
              {request.status === FRIEND_REQUEST_STATUS.pending && (
                <Button size="sm" variant="outline" disabled={!overview.running || cancel.isPending} onClick={() => cancel.mutate(request.zalo_uid)}
                  aria-label={`Hủy lời mời ${request.display_name || request.zalo_uid}`}>
                  {cancel.isPending && cancel.variables === request.zalo_uid ? <Loader2 className="animate-spin" /> : <Undo2 />}
                  Hủy
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * Tab «Kết bạn» của trang tài khoản bot: tra số điện thoại → mời kết bạn, đồng ý / từ chối lời mời đến, rút lời mời đã
 * gửi. Mục đích: nhân sự kết bạn với bot rồi kéo bot vào nhóm Zalo công việc để bot đọc tin.
 */
export function AccountFriendsTab({ account }: { account: BotAccountDetail }) {
  const overview = useFriendOverview(account.id)
  const refresh = useRefreshFriends(account.id)
  const data = overview.data
  return (
    <div className="flex flex-col gap-4">
      <FriendHelp />
      {overview.isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
      {overview.isError && <Card><p className="p-4 text-sm text-destructive">Không tải được danh sách kết bạn.</p></Card>}
      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {data.running ? (
              <span />
            ) : (
              <p className="flex items-center gap-2 text-sm text-warning">
                <TriangleAlert className="size-4" />
                Tài khoản bot đang tắt hoặc chưa kết nối Zalo — chỉ xem được danh sách; bật tài khoản để tìm, gửi, đồng ý lời mời.
              </p>
            )}
            <Button variant="outline" size="sm" disabled={!data.running || refresh.isPending} onClick={() => refresh.mutate()}>
              {refresh.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Làm mới
            </Button>
          </div>
          <FriendSearchCard accountId={account.id} overview={data} />
          <IncomingCard accountId={account.id} overview={data} />
          <SentCard accountId={account.id} overview={data} />
        </>
      )}
    </div>
  )
}
