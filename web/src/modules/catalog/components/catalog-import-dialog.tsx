import { FileUp, Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { useImportCatalog } from '../hooks/use-catalog-mutations'
import type { CatalogImportSummary } from '../types/catalog'

interface CatalogImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function ImportResult({ summary }: { summary: CatalogImportSummary }) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        Mới <b>{summary.created}</b> · cập nhật <b>{summary.updated}</b> · khớp <b>{summary.matched}</b> · gợi ý chờ xác nhận{' '}
        <b>{summary.suggested}</b> · chưa khớp <b>{summary.unmatched}</b>
      </p>
      {summary.errors.length > 0 && (
        <div>
          <p className="font-medium text-destructive">{summary.errors.length} dòng có lỗi (dòng đúng vẫn được nạp)</p>
          <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-muted-foreground">
            {summary.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Chọn tệp .xlsx theo mẫu → nạp → hiện tóm tắt + lỗi từng dòng. Lỗi cả tệp (422) do toast đỏ của `http-client` báo. */
export function CatalogImportDialog({ open, onOpenChange }: CatalogImportDialogProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const mutation = useImportCatalog()

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setFile(null)
      mutation.reset()
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nạp danh mục nhân viên / đại lý</DialogTitle>
          <DialogDescription>
            Chọn tệp Excel theo mẫu (sheet NhanVien, DaiLy). Nạp lại cùng mã thì cập nhật, không nhân bản; mục đã xác nhận giữ nguyên liên hệ Zalo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            aria-label="Chọn tệp Excel danh mục"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              mutation.reset()
              event.target.value = ''
            }}
          />
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={mutation.isPending}>
            <FileUp />
            {file ? file.name : 'Chọn tệp .xlsx'}
          </Button>
          {mutation.data && <ImportResult summary={mutation.data} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Đóng
          </Button>
          <Button disabled={!file || mutation.isPending || mutation.isSuccess} onClick={() => file && mutation.mutate(file)}>
            {mutation.isPending && <Loader2 className="animate-spin" />}
            Nạp danh mục
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
