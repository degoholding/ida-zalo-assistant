import { BookOpenText, Download, Eye, Loader2, Pin, PinOff, RefreshCw } from 'lucide-react'
import { useState, type MouseEvent } from 'react'

import { Button } from '@/shared/ui/button'
import { useExtractFile, useRetryFile, useSetKeepFile } from '../hooks/use-files'
import { FILE_STATUS, type FileRecord } from '../types/file'
import { FileTextDialog } from './file-text-dialog'

/**
 * Cột hành động của bảng Tệp: tải về / đọc chữ / xem chữ / giữ tệp gốc (đã có trong kho), xem chữ (tệp gốc đã xóa theo
 * hạn, chữ còn), hoặc tải vào kho (lỗi / chưa lấy).
 */
export function FileRowActions({ file }: { file: FileRecord }) {
  const retry = useRetryFile()
  const extract = useExtractFile()
  const keep = useSetKeepFile()
  const [showText, setShowText] = useState(false)
  const stop = (event: MouseEvent) => event.stopPropagation()

  const viewTextButton = (
    <Button variant="outline" size="sm" title="Xem chữ đã bóc" onClick={(event) => { stop(event); setShowText(true) }}>
      <Eye />
      Xem chữ
    </Button>
  )
  const textDialog = showText && <FileTextDialog file={file} open={showText} onOpenChange={setShowText} />

  if (file.download_url) {
    const keepLabel = file.keep_file ? 'Bỏ giữ tệp gốc' : 'Giữ tệp gốc'
    return (
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" asChild onClick={stop} title="Tải về">
          <a href={file.download_url} download>
            <Download />
          </a>
        </Button>
        {file.text_chars === null ? (
          <Button variant="outline" size="sm" disabled={extract.isPending} title="Bóc chữ trong tệp (xlsx, docx, pdf, ảnh…)"
            onClick={(event) => { stop(event); extract.mutate(file.id) }}>
            {extract.isPending ? <Loader2 className="animate-spin" /> : <BookOpenText />}
            Đọc
          </Button>
        ) : (
          viewTextButton
        )}
        <Button
          variant={file.keep_file ? 'secondary' : 'outline'}
          size="sm"
          disabled={keep.isPending}
          aria-label={keepLabel}
          title={file.keep_file ? 'Bỏ giữ — tệp gốc xóa theo hạn giữ tệp của nhóm' : 'Giữ tệp gốc — không xóa khi hết hạn giữ tệp của nhóm'}
          onClick={(event) => { stop(event); keep.mutate({ id: file.id, keepFile: !file.keep_file }) }}
        >
          {keep.isPending ? <Loader2 className="animate-spin" /> : file.keep_file ? <PinOff /> : <Pin />}
        </Button>
        {textDialog}
      </div>
    )
  }
  // Tệp gốc đã xóa theo hạn nhưng chữ đã bóc vẫn còn — vẫn xem được thứ bot «nhìn thấy»
  if (file.status === FILE_STATUS.expired) {
    if (file.text_chars === null) return null
    return (
      <div className="flex items-center gap-1">
        {viewTextButton}
        {textDialog}
      </div>
    )
  }
  if (!file.can_retry) return null
  return (
    <Button variant="outline" size="sm" disabled={retry.isPending} onClick={(event) => { stop(event); retry.mutate(file.id) }}>
      {retry.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      Tải vào kho
    </Button>
  )
}
