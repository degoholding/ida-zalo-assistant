import { Card } from '@/shared/ui/card'
import { SectionHeading } from '@/shared/ui/section-heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { formatDate } from '@/shared/utils/format-date'
import type { McpUsage, McpUsageCounts, McpUsageGroupBy } from '../types/mcp-usage'
import { failureRate, formatCount, formatDurationMs } from '../utils/format-usage-number'

/** Bốn ô tổng của cả khoảng. */
export function McpUsageTotals({ totals }: { totals: McpUsageCounts }) {
  const tiles = [
    { label: 'Lượt gọi', value: formatCount(totals.calls), hint: `Lỗi / bị chặn: ${failureRate(totals)}` },
    { label: 'Thời gian trung bình', value: formatDurationMs(totals.avg_ms), hint: `p95: ${formatDurationMs(totals.p95_ms)}` },
    { label: 'Dòng trả ra', value: formatCount(totals.rows), hint: `${formatCount(totals.chars)} ký tự` },
    { label: 'Token ước lượng', value: formatCount(totals.est_tokens), hint: 'Ký tự trả cho AI chia 4' },
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} className="gap-1 p-4">
          <span className="text-xs text-muted-foreground">{tile.label}</span>
          <span className="text-xl font-semibold text-navy">{tile.value}</span>
          <span className="text-xs text-muted-foreground">{tile.hint}</span>
        </Card>
      ))}
    </div>
  )
}

function CountHeads() {
  return (
    <>
      <TableHead className="text-right">Lượt</TableHead>
      <TableHead className="text-right">Lỗi</TableHead>
      <TableHead className="text-right">Bị chặn / quá nhịp</TableHead>
      <TableHead className="text-right">TB</TableHead>
      <TableHead className="text-right">p95</TableHead>
      <TableHead className="text-right">Dòng</TableHead>
      <TableHead className="text-right">Token ước lượng</TableHead>
    </>
  )
}

function CountCells({ row }: { row: McpUsageCounts }) {
  return (
    <>
      <TableCell className="text-right">{formatCount(row.calls)}</TableCell>
      <TableCell className="text-right">{formatCount(row.errors)}</TableCell>
      <TableCell className="text-right">{formatCount(row.rejected + row.rate_limited)}</TableCell>
      <TableCell className="text-right whitespace-nowrap">{formatDurationMs(row.avg_ms)}</TableCell>
      <TableCell className="text-right whitespace-nowrap">{formatDurationMs(row.p95_ms)}</TableCell>
      <TableCell className="text-right">{formatCount(row.rows)}</TableCell>
      <TableCell className="text-right">{formatCount(row.est_tokens)}</TableCell>
    </>
  )
}

const EMPTY_TEXT = 'Chưa có lượt gọi nào trong khoảng này.'

/** Bảng ngày × khóa (hoặc × người). */
export function McpUsageDailyTable({ usage, groupBy }: { usage: McpUsage; groupBy: McpUsageGroupBy }) {
  return (
    <Card className="gap-3 p-4 sm:p-5">
      <SectionHeading>Theo ngày</SectionHeading>
      {usage.daily.length === 0 ? (
        <p className="text-sm text-muted-foreground">{EMPTY_TEXT}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ngày</TableHead>
              <TableHead>{groupBy === 'key' ? 'Khóa' : 'Người'}</TableHead>
              {groupBy === 'key' && <TableHead>Chủ khóa</TableHead>}
              <CountHeads />
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.daily.map((row) => (
              <TableRow key={`${row.day}-${row.subject_id ?? 'none'}`}>
                <TableCell className="whitespace-nowrap">{formatDate(row.day)}</TableCell>
                <TableCell>{row.subject_name}</TableCell>
                {groupBy === 'key' && <TableCell>{row.owner_name || '—'}</TableCell>}
                <CountCells row={row} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {usage.truncated && <p className="text-xs text-muted-foreground">Chỉ hiện 500 dòng đầu — thu hẹp khoảng ngày để xem đủ.</p>}
    </Card>
  )
}

/** Công cụ dùng nhiều nhất trong khoảng. */
export function McpUsageToolTable({ usage }: { usage: McpUsage }) {
  return (
    <Card className="gap-3 p-4 sm:p-5">
      <SectionHeading>Công cụ dùng nhiều nhất</SectionHeading>
      {usage.top_tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">{EMPTY_TEXT}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Công cụ</TableHead>
              <CountHeads />
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.top_tools.map((row) => (
              <TableRow key={row.tool}>
                <TableCell className="font-mono text-xs">{row.tool}</TableCell>
                <CountCells row={row} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}
