import { Link } from 'react-router-dom'

import { GroupKindBadge } from '@/shared/contact-card/contact-badges'
import { CONVERSATION_TYPE } from '@/shared/contact-card/contact-constants'
import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { appRoutes, fileDownloadUrl } from '@/shared/constants/app-routes'
import { Card } from '@/shared/ui/card'
import { Pill } from '@/shared/ui/pill'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { StatusTone } from '@/shared/ui/status-tone'
import { formatDateTime } from '@/shared/utils/format-date'
import { formatFileSize } from '@/shared/utils/format-file-size'
import type { ContactDetail } from '../types/contact'

/** Trạng thái lượt hỏi bot — khớp `AssistantTurnStatus` của máy chủ. */
const TURN_STATUS: Record<number, [string, StatusTone]> = {
  0: ['Đã trả lời', 'done'],
  1: ['Lỗi', 'danger'],
  2: ['Quá số câu/giờ', 'pending'],
  3: ['Hết hạn mức ngày', 'pending'],
}

const FILE_STORED = 1

function EmptyNote({ children }: { children: string }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>
}

export function ContactGroupsTab({ contact }: { contact: ContactDetail }) {
  if (!contact.groups.length) return <Card><EmptyNote>Không ở nhóm nào bot đang đọc.</EmptyNote></Card>
  return (
    <Card className="gap-0 p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nhóm</TableHead>
            <TableHead>Loại nhóm</TableHead>
            <TableHead className="text-right">Thành viên</TableHead>
            <TableHead>Vai trò</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contact.groups.map((group) => (
            <TableRow key={group.id}>
              <TableCell>
                <Link to={appRoutes.groups.detail(group.id)} className="flex items-center gap-2 hover:underline">
                  <EntityAvatar name={group.name} avatarUrl={group.avatar_url} shape="rounded" className="size-7" />
                  <span className="truncate">{group.name}</span>
                </Link>
              </TableCell>
              <TableCell><GroupKindBadge groupKind={group.group_kind} /></TableCell>
              <TableCell className="text-right">{group.member_count}</TableCell>
              <TableCell className="text-muted-foreground">
                {group.left_at ? 'Đã rời' : group.is_admin ? 'Trưởng / phó nhóm' : 'Thành viên'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

export function ContactRecentTab({ contact }: { contact: ContactDetail }) {
  if (!contact.recent.length) return <Card><EmptyNote>Chưa có tin nào được lưu.</EmptyNote></Card>
  return (
    <Card className="gap-0 p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ở đâu</TableHead>
            <TableHead>Nội dung</TableHead>
            <TableHead className="text-right">Lúc gửi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contact.recent.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <Link to={appRoutes.conversations.detail(item.thread_id)} className="font-medium hover:underline">
                  {item.thread_type === CONVERSATION_TYPE.direct ? 'Nhắn riêng bot' : item.thread_name}
                </Link>
              </TableCell>
              <TableCell className="max-w-[480px] truncate">{item.text || (item.file_name ? `[Tệp] ${item.file_name}` : '(ảnh / tệp)')}</TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">{formatDateTime(item.sent_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

export function ContactFilesTab({ contact }: { contact: ContactDetail }) {
  if (!contact.files.length) return <Card><EmptyNote>Chưa gửi tệp nào.</EmptyNote></Card>
  return (
    <Card className="gap-0 p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tệp</TableHead>
            <TableHead>Ở đâu</TableHead>
            <TableHead className="text-right">Cỡ</TableHead>
            <TableHead className="text-right">Lúc gửi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contact.files.map((file) => (
            <TableRow key={file.id}>
              <TableCell className="max-w-[360px] truncate">
                {file.status === FILE_STORED
                  ? <a className="text-primary hover:underline" href={fileDownloadUrl(file.id)}>{file.file_name || '(tệp)'}</a>
                  : <span>{file.file_name || '(tệp)'}</span>}
              </TableCell>
              <TableCell className="text-muted-foreground">{file.thread_name}</TableCell>
              <TableCell className="text-right">{file.stored_bytes ? formatFileSize(file.stored_bytes) : '—'}</TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">{formatDateTime(file.sent_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

export function ContactTurnsTab({ contact }: { contact: ContactDetail }) {
  if (!contact.turns.length) return <Card><EmptyNote>Chưa hỏi bot lần nào.</EmptyNote></Card>
  return (
    <Card className="gap-0 p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Câu hỏi</TableHead>
            <TableHead>Kết quả</TableHead>
            <TableHead className="text-right">Token</TableHead>
            <TableHead className="text-right">Lúc hỏi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contact.turns.map((turn) => {
            const [label, tone] = TURN_STATUS[turn.status] ?? ['', 'neutral']
            return (
              <TableRow key={turn.id}>
                <TableCell className="max-w-[480px] truncate">{turn.question ?? '—'}</TableCell>
                <TableCell><Pill tone={tone}>{label}</Pill></TableCell>
                <TableCell className="text-right">{(turn.input_tokens + turn.output_tokens).toLocaleString('vi-VN')}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">{formatDateTime(turn.created_at)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}
