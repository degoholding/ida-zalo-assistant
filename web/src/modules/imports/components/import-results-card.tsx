import { Loader2 } from 'lucide-react'

import { Badge } from '@/shared/ui/badge'
import { Card } from '@/shared/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { formatDate, formatDateTime } from '@/shared/utils/format-date'
import { formatFileSize } from '@/shared/utils/format-file-size'
import { useImportResults } from '../hooks/use-imports'

const vi = (value: number) => value.toLocaleString('vi-VN')

/** Mỗi cuộc đã có tin cũ trong kho: số tin, tệp đã tải, dung lượng, mốc cũ nhất, lần nhập cuối. `active`: ghế đang nạp → hỏi lại đều. */
export function ImportResultsCard({ active = false }: { active?: boolean }) {
  const results = useImportResults(active)
  const rows = results.data ?? []
  const totalMessages = rows.reduce((sum, row) => sum + row.messages, 0)
  const totalFiles = rows.reduce((sum, row) => sum + (row.attachments || 0), 0)
  const totalBytes = rows.reduce((sum, row) => sum + (row.attachments_bytes || 0), 0)
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-navy">Đã có trong kho</h2>
        {results.isLoading && <Loader2 className="size-4 animate-spin" />}
        {rows.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {vi(rows.length)} cuộc · {vi(totalMessages)} tin · {vi(totalFiles)} tệp · {formatFileSize(totalBytes)}
          </span>
        )}
      </div>
      {!results.isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">Chưa có cuộc nào.</p>}
      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cuộc</TableHead>
              <TableHead className="text-right">Tin</TableHead>
              <TableHead className="text-right">Tệp</TableHead>
              <TableHead className="text-right">Dung lượng</TableHead>
              <TableHead>Từ</TableHead>
              <TableHead>Nhập lần cuối</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.group_id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span>{row.name || row.zalo_thread_id}</span>
                    <Badge variant="outline">{row.thread_type === 0 ? 'riêng' : 'nhóm'}</Badge>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{vi(row.messages)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.attachments ? vi(row.attachments) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{row.attachments_bytes ? formatFileSize(row.attachments_bytes) : '—'}</TableCell>
                <TableCell>{row.oldest ? formatDate(row.oldest) : '—'}</TableCell>
                <TableCell>{row.last_import_at ? formatDateTime(row.last_import_at) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}
