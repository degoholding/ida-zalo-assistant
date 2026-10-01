import { Link } from 'react-router-dom'

import { GroupKindBadge } from '@/shared/contact-card/contact-badges'
import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { appRoutes } from '@/shared/constants/app-routes'
import { Card } from '@/shared/ui/card'
import { Pill } from '@/shared/ui/pill'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { CompanyDetail } from '../types/company'

/** Tab Nhóm của công ty: nhóm Zalo đã gán vào công ty này. */
export function CompanyGroupsTab({ company }: { company: CompanyDetail }) {
  if (!company.groups.length) {
    return <Card><p className="p-4 text-sm text-muted-foreground">Chưa gán nhóm nào — mở một nhóm và chọn công ty này ở ô «Công ty».</p></Card>
  }
  return (
    <Card className="gap-0 p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nhóm</TableHead>
            <TableHead>Loại nhóm</TableHead>
            <TableHead className="text-right">Thành viên</TableHead>
            <TableHead>Đọc tin</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {company.groups.map((group) => (
            <TableRow key={group.id}>
              <TableCell>
                <Link to={appRoutes.groups.detail(group.id)} className="flex items-center gap-2 hover:underline">
                  <EntityAvatar name={group.name} avatarUrl={group.avatar_url} shape="rounded" className="size-7" />
                  <span className="truncate">{group.name}</span>
                </Link>
              </TableCell>
              <TableCell><GroupKindBadge groupKind={group.group_kind} /></TableCell>
              <TableCell className="text-right">{group.member_count}</TableCell>
              <TableCell>{group.read_messages ? <Pill tone="done">Đang đọc</Pill> : <span className="text-xs text-muted-foreground">Tắt</span>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
