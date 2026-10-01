import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { formatDateTime } from '@/shared/utils/format-date'
import { useFileText } from '../hooks/use-files'
import type { FileRecord } from '../types/file'

const METHOD_LABEL: Record<string, string> = { text: 'tệp văn bản', xlsx: 'bảng tính', docx: 'Word', gemini: 'mô hình đọc (pdf / ảnh)' }

interface FileTextDialogProps {
  file: FileRecord
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Xem chữ đã bóc của một tệp — đúng thứ bot «nhìn thấy» khi đọc tệp này. */
export function FileTextDialog({ file, open, onOpenChange }: FileTextDialogProps) {
  const { data, isLoading, isError } = useFileText(open ? file.id : null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{file.file_name || '(tệp)'}</DialogTitle>
          <DialogDescription>
            {data
              ? `${METHOD_LABEL[data.method] ?? data.method} · ${data.char_count.toLocaleString('vi-VN')} ký tự · đọc lúc ${formatDateTime(data.extracted_at)}${data.summary ? ` · ${data.summary}` : ''}`
              : 'Chữ bóc ra từ tệp — đúng thứ bot thấy khi đọc.'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-3">
          {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
          {isError && <p className="text-sm text-muted-foreground">Tệp này chưa được đọc — bấm «Đọc» ở dòng tệp.</p>}
          {data && <pre className="font-sans text-sm whitespace-pre-wrap">{data.text}</pre>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
