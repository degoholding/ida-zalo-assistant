import { Bookmark, FileJson, Loader2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { CopyButton } from '@/shared/ui/copy-button'
import { PageContainer } from '@/shared/ui/page-container'
import { PageHeader } from '@/shared/ui/page-header'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { formatDateTime } from '@/shared/utils/format-date'
import { ImportResultsCard } from '../components/import-results-card'
import { SeatSyncCard } from '../components/seat-sync-card'
import { useExportTargets, useImportZaloWeb } from '../hooks/use-imports'
import { IMPORT_FILES_MODE_LABELS, type BatchImportResult, type ImportFilesMode, type ImportSummary } from '../types/import'
import { buildZaloWebExporter, EXPORT_ALL_CONVERSATIONS, toBookmarklet } from '../utils/zalo-web-exporter'

const STEPS = [
  'Mở chat.zalo.me trên máy tính, đăng nhập bằng tài khoản Zalo của MỘT THÀNH VIÊN lâu năm trong các nhóm cần lấy (không phải tài khoản bot — đăng nhập web bằng tài khoản bot là bot bị đá, phải quét QR lại).',
  'Trên điện thoại, khi Zalo hỏi "Đồng bộ tin nhắn sang máy tính?" thì bấm Đồng ý; chờ web báo "Đồng bộ tin nhắn thành công". Zalo Web chỉ đồng bộ khoảng 2 tuần gần nhất — muốn lấy nhiều năm thì dùng ghế Zalo PC ở Cách 1.',
  'Kéo nút xuất bên dưới lên thanh dấu trang (Ctrl+Shift+B để hiện thanh). Ở Zalo Web, đứng ở tab Tin nhắn (danh sách "Tất cả", không lọc) rồi bấm nút: trang tự mở lần lượt từng cuộc, cuộn lên đầu, gom tin + ảnh, mỗi cuộc tải về một tệp .json. Góc phải dưới có bảng tiến độ và nút Dừng. Chrome hỏi "tải nhiều tệp" thì bấm Cho phép.',
  'Chọn TẤT CẢ tệp .json vừa tải ở bước 3 (giữ Ctrl để chọn nhiều). Nhóm: chỉ nhập được nhóm bot ĐÃ biết và đã bật "Đọc tin". Chat riêng: nhập vào cuộc riêng của tài khoản nghe có cùng mã Zalo với người xuất (tài khoản chưa gắn vào bot thì bỏ tệp). Tin trùng với tin bot đã lưu thì bỏ qua — nạp lại nhiều lần không nhân đôi.',
]

const FILES_MODES: ImportFilesMode[] = ['images_pdf', 'none', 'all']

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
          <dt className="text-muted-foreground">Tệp chat riêng của tài khoản chưa gắn</dt><dd>{summary.skipped_unknown_account ?? 0}</dd>
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

/**
 * Nhập lịch sử: Cách 1 ghế Zalo PC (phase 14, nhiều năm, tự chạy) — Cách 2 tệp xuất từ Zalo Web (~2 tuần, bấm tay).
 * Cả hai đổ vào cùng API nhập nên bảng «Kết quả nhập theo cuộc» gom chung.
 */
export function ZaloWebImportPage() {
  const importZaloWeb = useImportZaloWeb()
  const targets = useExportTargets()
  const [result, setResult] = useState<BatchImportResult | null>(null)
  const [showSource, setShowSource] = useState(false)
  const [filesMode, setFilesMode] = useState<ImportFilesMode>('images_pdf')
  const fileInput = useRef<HTMLInputElement>(null)

  const targetList = useMemo(() => targets.data ?? [], [targets.data])
  const allGroupsSource = useMemo(() => buildZaloWebExporter(targetList), [targetList])
  const openGroupSource = useMemo(() => buildZaloWebExporter(null), [])
  const everythingSource = useMemo(() => buildZaloWebExporter(EXPORT_ALL_CONVERSATIONS), [])

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return
    importZaloWeb.mutate({ files: [...files], mode: filesMode }, { onSuccess: setResult })
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    <PageContainer className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Nhập lịch sử"
        description="Zalo không có API lấy tin cũ. Hai đường lấy về kho bot: ghế Zalo PC (điện thoại đồng bộ toàn bộ lịch sử, tự chạy) hoặc tệp xuất từ Zalo Web (~2 tuần gần nhất, bấm tay)."
      />
      <SeatSyncCard />
      <ImportResultsCard />
      <Card className="gap-3 p-4">
        <h2 className="font-semibold text-navy">Cách 2 — Zalo Web: ~2 tuần gần nhất, bốn bước</h2>
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
              ? '"Nhóm của bot": tự mở lần lượt các nhóm đang bật "Đọc tin" ở màn Nhóm (bật thêm nhóm thì kéo lại nút này). "Toàn bộ danh sách": mọi cuộc ở cột trái Zalo Web, cả nhóm lẫn chat riêng. "Cuộc đang mở": chỉ cuộc đang mở (nhóm hoặc chat riêng). Mỗi cuộc một tệp.'
              : 'Bot chưa bật "Đọc tin" ở nhóm nào nên chưa có nút "Nhóm của bot". "Toàn bộ danh sách": mọi cuộc ở cột trái Zalo Web; "Cuộc đang mở": chỉ cuộc đang mở. Mỗi cuộc một tệp.'}
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
        <div className="flex flex-wrap items-center gap-3">
          <Select value={filesMode} onValueChange={(next) => setFilesMode(next as ImportFilesMode)}>
            <SelectTrigger className="w-64" aria-label="Tệp đính kèm của tin nhập">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILES_MODES.map((mode) => <SelectItem key={mode} value={mode}>{IMPORT_FILES_MODE_LABELS[mode]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => fileInput.current?.click()} disabled={importZaloWeb.isPending}>
            {importZaloWeb.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
            Chọn các tệp zalo-web-….json
          </Button>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><FileJson className="size-3.5" /> chọn nhiều tệp một lượt, mỗi tệp tối đa 50 MB</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Tệp đính kèm của tin nhập áp riêng cho lượt nhập này, không đổi công tắc "Lấy file" của nhóm. Link ảnh quá cũ trên máy chủ Zalo có thể đã hết hạn: tin vẫn vào, tệp ghi lỗi tải.
        </p>
      </Card>
      {result && <SummaryCard result={result} />}
    </PageContainer>
  )
}
