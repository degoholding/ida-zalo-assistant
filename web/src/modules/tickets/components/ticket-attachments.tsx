import { FileDown, Loader2, Paperclip } from 'lucide-react'

import { Card } from '@/shared/ui/card'
import { ImageLightbox, useImageLightbox } from '@/shared/ui/image-lightbox'
import { SectionHeading } from '@/shared/ui/section-heading'
import { formatFileSize } from '@/shared/utils/format-file-size'
import { ATTACHMENT_STATUS_PENDING, type TicketAttachment } from '../types/ticket'
import { splitTicketAttachments } from '../utils/split-ticket-attachments'

/**
 * Ảnh / tệp người gửi kèm ticket. Ảnh đã vào kho hiện thành lưới ảnh nhỏ, bấm mở bộ xem ảnh dùng chung; tệp khác là
 * link tải về. Tệp chưa có trong kho thì nói rõ đang tải hay không lấy được — đừng để một ô trống không lời.
 */
export function TicketAttachments({ attachments }: { attachments: TicketAttachment[] }) {
  const lightbox = useImageLightbox()
  const { images, files } = splitTicketAttachments(attachments)

  return (
    <Card className="gap-4 p-4 sm:p-5">
      <SectionHeading>Ảnh / tệp kèm ({attachments.length})</SectionHeading>

      {attachments.length === 0 && <p className="text-sm text-muted-foreground">Người gửi không kèm ảnh hay tệp nào.</p>}

      {images.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => lightbox.openAt(index)}
              title={image.name}
              className="aspect-square overflow-hidden rounded-md border bg-muted outline-none hover:ring-2 hover:ring-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img src={image.url} alt={image.name} loading="lazy" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <ul className="divide-y rounded-md border">
          {files.map((file) => (
            <li key={file.id} className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
              <Paperclip className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={file.file_name}>
                {file.file_name}
              </span>
              {file.bytes ? <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(file.bytes)}</span> : null}
              {file.download_url ? (
                <a href={file.download_url} download className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline">
                  <FileDown className="size-4" />
                  Tải về
                </a>
              ) : file.status === ATTACHMENT_STATUS_PENDING ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  đang tải về kho
                </span>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">không có trong kho</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <ImageLightbox images={images} {...lightbox.bind} />
    </Card>
  )
}
