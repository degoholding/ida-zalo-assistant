import { BookOpenText, Download, Eye, Loader2, RefreshCw } from 'lucide-react'
import { useState, type MouseEvent } from 'react'

import { Button } from '@/shared/ui/button'
import { useExtractFile, useRetryFile } from '../hooks/use-files'
import type { FileRecord } from '../types/file'
import { FileTextDialog } from './file-text-dialog'

/** Cột hành động của bảng Tệp: tải về / đọc chữ / xem chữ (đã có trong kho), hoặc tải vào kho (lỗi / chưa lấy). */
export function FileRowActions({ file }: { file: FileRecord }) {
  const retry = useRetryFile()
  const extract = useExtractFile()
  const [showText, setShowText] = useState(false)
  const stop = (event: MouseEvent) => event.stopPropagation()

  if (file.download_url) {
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
          <Button variant="outline" size="sm" title="Xem chữ đã bóc" onClick={(event) => { stop(event); setShowText(true) }}>
            <Eye />
            Xem chữ
          </Button>
        )}
        {showText && <FileTextDialog file={file} open={showText} onOpenChange={setShowText} />}
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
