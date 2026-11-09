import { Loader2 } from 'lucide-react'

import { Badge } from '@/shared/ui/badge'
import { Card } from '@/shared/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { formatDate, formatDateTime } from '@/shared/utils/format-date'
import { useImportResults } from '../hooks/use-imports'

/** Mỗi cuộc từng được nhập tin cũ (ghế Zalo PC hay tệp Zalo Web): tin đang có trong kho, mốc cũ nhất, lần nhập cuối. */
export function ImportResultsCard() {
  const results = useImportResults()
  const rows = results.data ?? []
  const totalMessages = rows.reduce((sum, row) => sum + row.messages, 0)
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-navy">Kết quả nhập theo cuộc</h2>
        {results.isLoading && <Loader2 className="size-4 animate-spin" />}
        {rows.length > 0 && (
          <span className="text-xs text-muted-foreground">{rows.length} cuộc · {totalMessages.toLocaleString('vi-VN')} tin đang trong kho</span>
        )}
      </div>
      {!results.isLoading && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Chưa cuộc nào được nhập tin cũ.</p>
      )}
      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cuộc</TableHead>
              <TableHead className="text-right">Tin trong kho</TableHead>
              <TableHead>Cũ nhất</TableHead>
              <TableHead>Mới nhất</TableHead>
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
                    {!row.read_messages && <Badge variant="secondary">chưa bật đọc</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-right">{row.messages.toLocaleString('vi-VN')}</TableCell>
                <TableCell>{row.oldest ? formatDate(row.oldest) : '—'}</TableCell>
                <TableCell>{row.newest ? formatDate(row.newest) : '—'}</TableCell>
                <TableCell>
                  {row.last_import_at ? formatDateTime(row.last_import_at) : '—'}
                  {row.imports > 1 && <span className="text-xs text-muted-foreground"> · {row.imports} lượt</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}
