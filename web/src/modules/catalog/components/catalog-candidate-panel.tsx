import { Loader2, Unlink } from 'lucide-react'

import { usePermission } from '@/core/authorization/use-permission'
import { EntityAvatar } from '@/shared/contact-card/entity-avatar'
import { getKindLabel } from '@/shared/contact-card/format-contact'
import { Button } from '@/shared/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { useCatalogMatchAction } from '../hooks/use-catalog-mutations'
import { CATALOG_MATCH_STATUS, type CatalogEntryDetail } from '../types/catalog'
import { CatalogMatchStatusBadge } from './catalog-match-status-badge'

/** Khối ở chi tiết: liên hệ Zalo đang gắn (nút "Bỏ gắn") và bảng ứng viên khi khớp không chắc (nút "Chọn"). */
export function CatalogCandidatePanel({ entry }: { entry: CatalogEntryDetail }) {
  const { can } = usePermission()
  const mutation = useCatalogMatchAction(entry.id)
  const canWrite = can('catalog', 'write')
  const busy = mutation.isPending
  const showCandidates = entry.match_status === CATALOG_MATCH_STATUS.suggested || (entry.contact_id === null && entry.candidates.length > 0)

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">Liên hệ Zalo</span>
        <CatalogMatchStatusBadge status={entry.match_status} />
        {entry.contact_id !== null && (
          <>
            <span className="flex items-center gap-2 text-sm">
              <EntityAvatar name={entry.contact_name ?? ''} avatarUrl={entry.contact_avatar_url} className="size-7 text-xs" />
              {entry.contact_name}
            </span>
            {canWrite && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => mutation.mutate({ action: 'unlink' })}>
                {busy && mutation.variables?.action === 'unlink' ? <Loader2 className="animate-spin" /> : <Unlink />}
                Bỏ gắn
              </Button>
            )}
          </>
        )}
        {entry.contact_id === null && !showCandidates && <span className="text-sm text-muted-foreground">Chưa có liên hệ nào khớp.</span>}
        {entry.match_status === CATALOG_MATCH_STATUS.unlinked && (
          <span className="text-sm text-muted-foreground">Đã bỏ gắn — khớp lại sẽ không tự gắn nữa, chọn tay người đúng bên dưới.</span>
        )}
      </div>
      {showCandidates && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ứng viên</TableHead>
              <TableHead>Loại</TableHead>
              <TableHead>SĐT</TableHead>
              <TableHead>Độ khớp</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entry.candidates.map((candidate) => (
              <TableRow key={candidate.contact_id}>
                <TableCell>
                  <span className="flex items-center gap-2 font-medium">
                    <EntityAvatar name={candidate.name} avatarUrl={candidate.avatar_url} className="size-7 text-xs" />
                    {candidate.name}
                  </span>
                </TableCell>
                <TableCell>{getKindLabel(candidate.kind)}</TableCell>
                <TableCell>{candidate.phone || '—'}</TableCell>
                <TableCell>{Math.round(candidate.score * 100)}%</TableCell>
                <TableCell className="text-right">
                  {candidate.linked_entry_name ? (
                    <span className="text-xs text-muted-foreground">Đã gắn "{candidate.linked_entry_name}"</span>
                  ) : (
                    canWrite && (
                      <Button size="sm" disabled={busy} onClick={() => mutation.mutate({ action: 'confirm', contact_id: candidate.contact_id })}>
                        {busy && mutation.variables?.action === 'confirm' && mutation.variables.contact_id === candidate.contact_id && <Loader2 className="animate-spin" />}
                        Chọn
                      </Button>
                    )
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
