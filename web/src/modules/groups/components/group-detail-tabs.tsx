import { Link } from 'react-router-dom'

import { KindBadge, RoleBadge } from '@/shared/contact-card/contact-badges'
import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { appRoutes } from '@/shared/constants/app-routes'
import { Card } from '@/shared/ui/card'
import { Pill } from '@/shared/ui/pill'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { formatDateTime } from '@/shared/utils/format-date'
import type { GroupDetail } from '../types/group'

function EmptyNote({ children }: { children: string }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>
}

/** Tab Thành viên: ảnh (bấm mở thẻ nổi), tên (bấm mở hồ sơ), loại, vai trò với bot, trưởng nhóm, đã rời. */
export function GroupMembersTab({ group }: { group: GroupDetail }) {
  if (!group.members.length) return <Card><EmptyNote>Chưa đồng bộ được thành viên — bot vào nhóm sẽ tự lấy.</EmptyNote></Card>
  return (
    <Card className="gap-0 p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Thành viên</TableHead>
            <TableHead>Loại</TableHead>
            <TableHead>Vai trò với bot</TableHead>
            <TableHead>Trong nhóm</TableHead>
            <TableHead className="text-right">Thấy lần đầu</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.members.map((member) => (
            <TableRow key={member.zalo_uid} className={member.left_at ? 'opacity-60' : undefined}>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  <EntityAvatar name={member.name} avatarUrl={member.avatar_url} cardUid={member.contact_id ? member.zalo_uid : null} className="size-8" />
                  {member.contact_id ? (
                    <Link to={appRoutes.contacts.detail(member.contact_id)} className="truncate font-medium hover:underline">{member.name}</Link>
                  ) : (
                    <span className="truncate">{member.name}</span>
                  )}
                </div>
              </TableCell>
              <TableCell><KindBadge kind={member.kind} isBot={member.is_bot} /></TableCell>
              <TableCell>{member.is_bot ? <span className="text-xs text-muted-foreground">—</span> : <RoleBadge role={member.role} />}</TableCell>
              <TableCell>
                {member.left_at ? <Pill tone="neutral">Đã rời</Pill> : member.is_admin ? <Pill tone="pending">Trưởng / phó nhóm</Pill> : <span className="text-muted-foreground">Thành viên</span>}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">{formatDateTime(member.first_seen_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

/** Tab Bot: tài khoản bot nào đang / từng ở trong nhóm. */
export function GroupBotsTab({ group }: { group: GroupDetail }) {
  if (!group.bots.length) return <Card><EmptyNote>Không còn tài khoản bot nào trong nhóm — bot bị mời ra hoặc đã tắt.</EmptyNote></Card>
  return (
    <Card className="gap-0 p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tài khoản bot</TableHead>
            <TableHead>Tên Zalo</TableHead>
            <TableHead>Vào nhóm</TableHead>
            <TableHead>Trạng thái</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.bots.map((bot) => (
            <TableRow key={bot.id}>
              <TableCell><Link to={appRoutes.accounts.detail(bot.id)} className="font-medium hover:underline">{bot.label}</Link></TableCell>
              <TableCell>{bot.display_name}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{formatDateTime(bot.joined_at)}</TableCell>
              <TableCell>{bot.left_at ? <Pill tone="neutral">Đã rời {formatDateTime(bot.left_at)}</Pill> : <Pill tone="done">Đang ở trong nhóm</Pill>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
