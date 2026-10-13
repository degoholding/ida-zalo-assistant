import { CircleCheck, CircleX, FlaskConical, Loader2 } from 'lucide-react'
import { useWatch, type Control } from 'react-hook-form'
import { useParams } from 'react-router-dom'

import { extractErrorMessage } from '@/core/api'
import type { CrudRecord } from '@/shared/crud/types'
import { Button } from '@/shared/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { formatDate } from '@/shared/utils/format-date'
import { useMetricSourcePreview } from '../hooks/use-metric-source-preview'
import type { MetricMapping, MetricPreview } from '../types/metric'
import { checkMappingColumns } from '../utils/check-mapping-columns'
import { formatMetricNumber } from '../utils/format-metric-number'
import { validateMetricMapping } from '../utils/validate-metric-mapping'
import { MetricFlagChips } from './metric-flag-chips'

function ColumnCheckList({ mapping, preview }: { mapping: MetricMapping; preview: MetricPreview }) {
  const checks = checkMappingColumns(mapping, preview.headers)
  const matched = new Map(preview.matched.map((item) => [item.code, item.column]))
  return (
    <ul className="grid gap-1 text-sm md:grid-cols-2">
      {checks.map((check) => (
        <li key={`${check.role}-${check.spec}`} className="flex items-center gap-2">
          {check.found ? <CircleCheck className="size-4 text-success" /> : <CircleX className="size-4 text-destructive" />}
          <span className="font-medium">{check.role}</span>
          <span className="text-muted-foreground">→ «{check.spec}»</span>
          {!check.found && <span className="text-destructive">không thấy</span>}
        </li>
      ))}
      {matched.size > 0 && <li className="text-xs text-muted-foreground md:col-span-2">Bảng khớp {matched.size} chỉ tiêu.</li>}
    </ul>
  )
}

function SampleTable({ preview }: { preview: MetricPreview }) {
  if (preview.sample.length === 0) return <p className="text-sm text-muted-foreground">Chưa đọc ra dòng nào trong 62 ngày gần nhất.</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Dòng</TableHead>
          <TableHead>Ngày</TableHead>
          <TableHead>Nhân viên</TableHead>
          <TableHead>Khu vực</TableHead>
          <TableHead>Chỉ tiêu</TableHead>
          <TableHead className="text-right">Giá trị</TableHead>
          <TableHead>Cờ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {preview.sample.map((row, index) => (
          <TableRow key={index}>
            <TableCell>{row.row}</TableCell>
            <TableCell>{formatDate(row.date)}</TableCell>
            <TableCell>{row.staff_name}</TableCell>
            <TableCell>{row.area_name || '—'}</TableCell>
            <TableCell>{row.code}</TableCell>
            <TableCell className="text-right">{row.value === null ? <span className="text-muted-foreground">{row.raw || '—'}</span> : formatMetricNumber(row.value)}</TableCell>
            <TableCell>
              <MetricFlagChips flags={row.flags} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

interface MetricSourcePreviewPanelProps {
  control: Control<CrudRecord>
}

/** Khung «Kiểm tra đọc thử»: đọc bảng bằng cấu hình ĐANG GÕ (chưa lưu), cho thấy tiêu đề thật, cột khớp ✓ / ✗, 10 dòng đầu và cảnh báo. */
export function MetricSourcePreviewPanel({ control }: MetricSourcePreviewPanelProps) {
  // Đang SỬA nguồn đã lưu (route `:id`) thì gửi kèm id để máy chủ ghi dòng «Lịch sử thao tác»; trang thêm mới không có
  const sourceId = Number(useParams().id) || undefined
  const values = useWatch({ control })
  const mutation = useMetricSourcePreview()
  const mapping = (values.mapping as MetricMapping | null) ?? null
  const mappingError = validateMetricMapping(mapping)
  const link = String(values.spreadsheet_url ?? '').trim()
  const sheetTitle = String(values.sheet_title ?? '').trim()
  const blocked = !link || !sheetTitle || mappingError !== null

  const run = () =>
    mutation.mutate({
      source_id: sourceId, spreadsheet_url: link, sheet_title: sheetTitle, header_row: Number(values.header_row) || 1, mapping,
    })
  const preview = mutation.data

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Kiểm tra đọc thử</h3>
          <p className="text-xs text-muted-foreground">Đọc bảng bằng cấu hình đang gõ ở trên (chưa cần lưu) — không ghi gì vào số liệu.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={run} disabled={blocked || mutation.isPending}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <FlaskConical />}
          Kiểm tra đọc thử
        </Button>
      </div>
      {blocked && <p className="text-xs text-muted-foreground">{mappingError ?? 'Điền link bảng, tên tab và ánh xạ cột trước.'}</p>}
      {mutation.isError && <p className="text-sm text-destructive">{extractErrorMessage(mutation.error)}</p>}
      {preview && !preview.ok && <p className="text-sm text-destructive">{preview.error}</p>}
      {preview?.ok && mapping && (
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Tiêu đề thấy ở dòng tiêu đề</p>
            <div className="flex flex-wrap gap-1">
              {preview.headers.map((header, index) => (
                <span key={index} className="rounded bg-muted px-2 py-0.5 text-xs">{header || `(cột ${index + 1} trống)`}</span>
              ))}
            </div>
          </div>
          <ColumnCheckList mapping={mapping} preview={preview} />
          <p className="text-sm">
            Bảng có <b>{preview.sheet_rows}</b> dòng, đọc ra <b>{preview.record_count}</b> số
            {preview.out_of_window > 0 ? ` (bỏ ${preview.out_of_window} dòng cũ hơn 62 ngày)` : ''}.
          </p>
          <SampleTable preview={preview} />
          {preview.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-warning">
              {preview.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
              {preview.warning_total > preview.warnings.length && <li>…và {preview.warning_total - preview.warnings.length} cảnh báo khác.</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
