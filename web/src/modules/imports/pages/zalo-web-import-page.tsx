import { Bookmark, FileJson, Loader2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { CopyButton } from '@/shared/ui/copy-button'
import { PageContainer } from '@/shared/ui/page-container'
import { PageHeader } from '@/shared/ui/page-header'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { formatDateTime } from '@/shared/utils/format-date'
import { useExportTargets, useImportZaloWeb } from '../hooks/use-imports'
import type { BatchImportResult, ImportSummary } from '../types/import'
import { buildZaloWebExporter, EXPORT_ALL_CONVERSATIONS, toBookmarklet } from '../utils/zalo-web-exporter'

const STEPS = [
  'Mở chat.zalo.me trên máy tính, đăng nhập bằng tài khoản Zalo của MỘT THÀNH VIÊN lâu năm trong các nhóm cần lấy (không phải tài khoản bot — đăng nhập web bằng tài khoản bot là bot bị đá, phải quét QR lại).',
  'Trên điện thoại, khi Zalo hỏi «Đồng bộ tin nhắn sang máy tính?» thì bấm Đồng ý; chờ web báo «Đồng bộ tin nhắn thành công». Zalo chỉ đồng bộ khoảng 2 tuần gần nhất — giới hạn của Zalo, không chỉnh được.',
  'Kéo nút xuất bên dưới lên thanh dấu trang (Ctrl+Shift+B để hiện thanh). Ở Zalo Web, đứng ở tab Tin nhắn (danh sách «Tất cả», không lọc) rồi bấm nút: trang tự mở lần lượt từng nhóm, cuộn lên đầu, gom tin + ảnh, mỗi nhóm tải về một tệp .json. Góc phải dưới có bảng tiến độ và nút Dừng. Chrome hỏi «tải nhiều tệp» thì bấm Cho phép.',
  'Chọn TẤT CẢ tệp .json vừa tải ở bước 4 (giữ Ctrl để chọn nhiều). Chỉ nhập được nhóm bot ĐÃ Ở và đã bật «Đọc tin»; tệp chat riêng giữ làm bản lưu, bot chưa nhập. Tin trùng với tin bot đã lưu thì bỏ qua — nạp lại nhiều lần không nhân đôi.',
]

interface BookmarkletLinkProps {
  href: string
  label: string
}

/** React 19 chặn `href="javascript:…"` (thay bằng câu báo lỗi) — gắn thẳng vào DOM thì React không đụng tới. */
function BookmarkletLink({ href, label }: BookmarkletLinkProps) {
  const anchor = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    anchor.current?.setAttribute('href', href)
  }, [href])
  return (
    <a
      ref={anchor}
      onClick={(event) => event.preventDefault()}
      draggable
      className="inline-flex h-9 cursor-grab items-center gap-2 rounded-md border border-primary bg-primary/10 px-3 text-sm font-medium text-primary"
      title="Kéo nút này lên thanh dấu trang"
    >
      <Bookmark className="size-4" />
      {label}
    </a>
  )
}

function SummaryCard({ result }: { result: BatchImportResult }) {
  const summary: ImportSummary | null = result.summary
  return (
    <Card className="gap-3 p-4">
      <h2 className="font-semibold text-navy">Kết quả nhập — {result.files} tệp</h2>
      {summary && (
        <dl className="grid grid-cols-[220px_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Tin trong tệp</dt><dd>{summary.total}</dd>
          <dt className="text-muted-foreground">Đã nhập mới</dt><dd className="font-semibold">{summary.imported}</dd>
          <dt className="text-muted-foreground">Bổ sung ảnh / chữ cho tin đã có</dt><dd>{summary.enriched}</dd>
          <dt className="text-muted-foreground">Trùng (bot đã có đủ)</dt><dd>{summary.duplicates}</dd>
          <dt className="text-muted-foreground">Nhóm bot chưa ở</dt><dd>{summary.skipped_unknown_group}</dd>
          <dt className="text-muted-foreground">Nhóm chưa bật đọc</dt><dd>{summary.skipped_group_not_read}</dd>
          <dt className="text-muted-foreground">Tin riêng (không nhập)</dt><dd>{summary.skipped_direct}</dd>
          <dt className="text-muted-foreground">Khoảng thời gian</dt>
          <dd>{summary.oldest ? `${formatDateTime(summary.oldest)} → ${formatDateTime(summary.newest)}` : '—'}</dd>
        </dl>
      )}
      {summary && summary.groups.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Nhóm</TableHead><TableHead className="text-right">Tin nhập mới</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {summary.groups.map((group) => (
              <TableRow key={group.zalo_group_id}>
                <TableCell>{group.name}</TableCell>
                <TableCell className="text-right">{group.imported}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {result.failures.length > 0 && (
        <ul className="space-y-1 text-sm text-destructive">
          {result.failures.map((failure) => <li key={failure.fileName}>{failure.fileName}: {failure.message}</li>)}
        </ul>
      )}
    </Card>
  )
}

/** Nhập ~2 tuần tin nhóm từ kho cục bộ của Zalo Web — đường duy nhất lấy được tin trước ngày bot vào nhóm. */
export function ZaloWebImportPage() {
  const importZaloWeb = useImportZaloWeb()
  const targets = useExportTargets()
  const [result, setResult] = useState<BatchImportResult | null>(null)
  const [showSource, setShowSource] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const targetList = useMemo(() => targets.data ?? [], [targets.data])
  const allGroupsSource = useMemo(() => buildZaloWebExporter(targetList), [targetList])
  const openGroupSource = useMemo(() => buildZaloWebExporter(null), [])
  const everythingSource = useMemo(() => buildZaloWebExporter(EXPORT_ALL_CONVERSATIONS), [])

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return
    importZaloWeb.mutate([...files], { onSuccess: setResult })
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    <PageContainer className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Nhập lịch sử từ Zalo Web"
        description="Zalo không có API lấy tin cũ; nhưng Zalo Web được điện thoại đồng bộ ~2 tuần tin gần nhất. Lấy phần đó về kho bot bằng bốn bước dưới đây — một lần bấm quét hết các nhóm bot đang đọc."
      />
      <Card className="gap-3 p-4">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {STEPS.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </Card>
      <Card className="gap-3 p-4">
        <h2 className="font-semibold text-navy">Bước 3 — nút xuất</h2>
        <div className="flex flex-wrap items-center gap-3">
          {targetList.length > 0 && <BookmarkletLink href={toBookmarklet(allGroupsSource)} label={`Xuất ${targetList.length} nhóm của bot`} />}
          <BookmarkletLink href={toBookmarklet(everythingSource)} label="Xuất toàn bộ danh sách" />
          <BookmarkletLink href={toBookmarklet(openGroupSource)} label="Xuất cuộc đang mở" />
        </div>
        <p className="text-xs text-muted-foreground">
          {targets.isLoading
            ? 'Đang tải danh sách nhóm…'
            : targetList.length
              ? '«Nhóm của bot»: tự mở lần lượt các nhóm đang bật «Đọc tin» ở màn Nhóm (bật thêm nhóm thì kéo lại nút này). «Toàn bộ danh sách»: mọi cuộc ở cột trái Zalo Web, cả nhóm lẫn chat riêng. «Cuộc đang mở»: chỉ cuộc đang mở (nhóm hoặc chat riêng). Mỗi cuộc một tệp.'
              : 'Bot chưa bật «Đọc tin» ở nhóm nào nên chưa có nút «Nhóm của bot». «Toàn bộ danh sách»: mọi cuộc ở cột trái Zalo Web; «Cuộc đang mở»: chỉ cuộc đang mở. Mỗi cuộc một tệp.'}
          {' '}Bấm ở trang này không chạy — chỉ chạy khi đang ở chat.zalo.me.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowSource((value) => !value)}>
            {showSource ? 'Ẩn mã' : 'Hiện mã để dán vào Console'}
          </Button>
          <CopyButton value={allGroupsSource} label="Chép mã (tất cả nhóm)" />
        </div>
        {showSource && <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">{allGroupsSource}</pre>}
      </Card>
      <Card className="gap-3 p-4">
        <h2 className="font-semibold text-navy">Bước 4 — nạp các tệp đã tải</h2>
        <input ref={fileInput} type="file" multiple accept="application/json,.json" className="hidden" onChange={(event) => handleFiles(event.target.files)} aria-label="Chọn tệp JSON" />
        <div className="flex items-center gap-2">
          <Button onClick={() => fileInput.current?.click()} disabled={importZaloWeb.isPending}>
            {importZaloWeb.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
            Chọn các tệp zalo-web-….json
          </Button>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><FileJson className="size-3.5" /> chọn nhiều tệp một lượt, mỗi tệp tối đa 50 MB</span>
        </div>
      </Card>
      {result && <SummaryCard result={result} />}
    </PageContainer>
  )
}
