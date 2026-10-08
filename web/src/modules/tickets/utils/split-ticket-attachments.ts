import type { LightboxImage } from '@/shared/ui/image-lightbox'
import type { TicketAttachment } from '../types/ticket'

export interface TicketImage extends LightboxImage {
  id: number
  /** Đường xem tại chỗ (`?inline=1`) — máy chủ chỉ trả ảnh với kiểu ảnh khi có cờ này, thiếu là trình duyệt tải về. */
  url: string
  name: string
}

/**
 * Tách tệp kèm thành ẢNH xem được (đã vào kho) và phần còn lại. Ảnh CHƯA vào kho (`download_url` rỗng) rơi sang
 * danh sách tệp để còn hiện «đang tải về kho» — bỏ vào lưới ảnh thì là một ô ảnh vỡ.
 */
export function splitTicketAttachments(attachments: TicketAttachment[]): { images: TicketImage[]; files: TicketAttachment[] } {
  const images: TicketImage[] = []
  const files: TicketAttachment[] = []
  for (const attachment of attachments) {
    if (attachment.is_image && attachment.download_url) {
      images.push({ id: attachment.id, url: `${attachment.download_url}?inline=1`, name: attachment.file_name })
    } else {
      files.push(attachment)
    }
  }
  return { images, files }
}
