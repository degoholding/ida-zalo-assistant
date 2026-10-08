import { Download, Eye, MessageSquareText } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { appRoutes } from '@/shared/constants/app-routes'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { cn } from '@/shared/utils/cn'
import { formatDateTime } from '@/shared/utils/format-date'
import { formatFileSize } from '@/shared/utils/format-file-size'
import { isImageFile, type FileRecord } from '../types/file'
import { getFileName } from '../utils/get-file-name'
import { FileStatusBadge } from './file-status-badge'
import { FileTextDialog } from './file-text-dialog'

interface FilePreviewDialogProps {
  file: FileRecord
  open: boolean
  onOpenChange: (open: boolean) => void
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

/**
 * Bấm tên tệp ở màn Tệp: ảnh (đã có trong kho) hiện ngay trong hộp thoại; tệp khác hiện thông tin. Hai nút chung:
 * «Tải về» và «Xem trong hội thoại» (mở cuộc, cuộn tới đúng tin gửi tệp này).
 */
export function FilePreviewDialog({ file, open, onOpenChange }: FilePreviewDialogProps) {
  const [showText, setShowText] = useState(false)
  const name = getFileName(file)
  const showImage = isImageFile(file) && Boolean(file.download_url)
  const sender = file.sender_name || file.sender_uid
  const where = `${sender} · ${formatDateTime(file.sent_at)} · ${file.thread_name}`

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn('sm:max-w-xl', showImage && 'flex max-h-[92vh] flex-col sm:max-w-4xl')}>
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{name}</DialogTitle>
            <DialogDescription className="truncate">{where}</DialogDescription>
          </DialogHeader>

          {showImage && file.download_url ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md bg-muted/40 p-2">
              <img src={`${file.download_url}?inline=1`} alt={name} className="max-h-[70vh] max-w-full object-contain" />
            </div>
          ) : (
            <dl className="divide-y rounded-md border px-3">
              <InfoRow label="Tên tệp">{name}</InfoRow>
              <InfoRow label="Cỡ">{file.size ? formatFileSize(file.size) : '—'}</InfoRow>
              <InfoRow label="Người gửi">{sender}</InfoRow>
              <InfoRow label="Lúc gửi">{formatDateTime(file.sent_at)}</InfoRow>
              <InfoRow label="Ở đâu">{file.thread_name}</InfoRow>
              <InfoRow label="Trạng thái">
                <FileStatusBadge status={file.status} lastError={file.last_error} keepFile={file.keep_file} />
              </InfoRow>
              <InfoRow label="Nội dung">
                {file.text_chars === null
                  ? <span className="text-muted-foreground">Chưa đọc — bấm «Đọc» ở dòng tệp để bóc chữ</span>
                  : `${file.text_summary ? `${file.text_summary} · ` : ''}${file.text_chars.toLocaleString('vi-VN')} ký tự`}
              </InfoRow>
            </dl>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" asChild>
              <Link to={appRoutes.conversations.message(file.thread_id, file.message_id)}>
                <MessageSquareText />
                Xem trong hội thoại
              </Link>
            </Button>
            <div className="flex flex-wrap gap-2">
              {file.text_chars !== null && (
                <Button variant="outline" onClick={() => setShowText(true)}>
                  <Eye />
                  Xem chữ
                </Button>
              )}
              {file.download_url && (
                <Button asChild>
                  <a href={file.download_url} download>
                    <Download />
                    Tải về
                  </a>
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {showText && <FileTextDialog file={file} open={showText} onOpenChange={setShowText} />}
    </>
  )
}
