import { Card } from '@/shared/ui/card'
import { SectionHeading } from '@/shared/ui/section-heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { formatDateTime } from '@/shared/utils/format-date'
import { getMcpCallStatusLabel, type McpCallLogRow } from '../types/mcp-key'

/** 50 lời gọi gần nhất của khóa — để chủ khóa nhận ra khóa bị dùng ngoài ý muốn. */
export function McpKeyCallLogTable({ calls }: { calls: McpCallLogRow[] }) {
  return (
    <Card className="gap-3 p-4 sm:p-5">
      <SectionHeading>Lời gọi gần nhất</SectionHeading>
      {calls.length === 0 ? (
        <p className="text-sm text-muted-foreground">Khóa này chưa được dùng lần nào.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lúc</TableHead>
              <TableHead>Công cụ</TableHead>
              <TableHead>Thực thể</TableHead>
              <TableHead>Kết quả</TableHead>
              <TableHead className="text-right">Số dòng</TableHead>
              <TableHead className="text-right">Thời gian</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.map((call) => (
              <TableRow key={call.id}>
                <TableCell className="whitespace-nowrap">{formatDateTime(call.created_at)}</TableCell>
                <TableCell className="font-mono text-xs">{call.tool}</TableCell>
                <TableCell>{call.entity ?? '—'}</TableCell>
                <TableCell>{getMcpCallStatusLabel(call.status) || 'Không rõ'}</TableCell>
                <TableCell className="text-right">{call.row_count}</TableCell>
                <TableCell className="text-right">{call.duration_ms} ms</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}
