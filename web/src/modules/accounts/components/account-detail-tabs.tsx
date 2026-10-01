import { Link } from 'react-router-dom'

import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { appRoutes } from '@/shared/constants/app-routes'
import { Card } from '@/shared/ui/card'
import { Pill } from '@/shared/ui/pill'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { formatDateTime } from '@/shared/utils/format-date'
import { SESSION_EVENT_LABELS, type BotAccountDetail } from '../types/account'

const ERROR_EVENTS = new Set([1, 4, 5, 6])

export function AccountGroupsTab({ account }: { account: BotAccountDetail }) {
  if (!account.groups.length) return <Card><p className="p-4 text-sm text-muted-foreground">Bot chưa ở nhóm nào — thêm tài khoản này vào nhóm Zalo.</p></Card>
  return (
    <Card className="gap-0 p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nhóm</TableHead>
            <TableHead className="text-right">Thành viên</TableHead>
            <TableHead>Đọc tin</TableHead>
            <TableHead>Vào nhóm</TableHead>
            <TableHead>Trạng thái</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {account.groups.map((group) => (
            <TableRow key={group.id} className={group.left_at ? 'opacity-60' : undefined}>
              <TableCell>
                <Link to={appRoutes.groups.detail(group.id)} className="flex items-center gap-2 hover:underline">
                  <EntityAvatar name={group.name} avatarUrl={group.avatar_url} shape="rounded" className="size-7" />
                  <span className="truncate">{group.name}</span>
                </Link>
              </TableCell>
              <TableCell className="text-right">{group.member_count}</TableCell>
              <TableCell>{group.read_messages ? <Pill tone="done">Đang đọc</Pill> : <span className="text-xs text-muted-foreground">Tắt</span>}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{formatDateTime(group.joined_at)}</TableCell>
              <TableCell>{group.left_at ? <Pill tone="neutral">Đã rời</Pill> : <Pill tone="done">Đang ở</Pill>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

/** Tab Nhật ký kết nối: 30 sự kiện phiên gần nhất (đăng nhập, mất kết nối, bị đá…). */
export function AccountEventsTab({ account }: { account: BotAccountDetail }) {
  if (!account.events.length) return <Card><p className="p-4 text-sm text-muted-foreground">Chưa có sự kiện nào.</p></Card>
  return (
    <Card className="gap-0 p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-44">Lúc</TableHead>
            <TableHead>Sự kiện</TableHead>
            <TableHead>Chi tiết</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {account.events.map((event) => (
            <TableRow key={event.id}>
              <TableCell className="text-xs text-muted-foreground">{formatDateTime(event.created_at)}</TableCell>
              <TableCell>
                <Pill tone={ERROR_EVENTS.has(event.event) ? 'danger' : event.event === 3 || event.event === 2 ? 'done' : 'neutral'}>
                  {SESSION_EVENT_LABELS[event.event] ?? `Sự kiện ${event.event}`}
                </Pill>
              </TableCell>
              <TableCell className="max-w-[520px] truncate text-muted-foreground" title={event.detail}>
                {event.code !== null ? `[${event.code}] ` : ''}{event.detail || '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
