import { MESSAGE_KIND_IMAGE, type FileRecord } from '../types/file'

/** Tên hiện ở màn Tệp: tên gốc; ảnh chụp gửi thẳng (không tên) thì «Hình ảnh»; còn lại ghi loại tin Zalo. */
export function getFileName(file: Pick<FileRecord, 'file_name' | 'file_ext' | 'message_kind' | 'zalo_msg_type'>): string {
  if (file.file_name) return file.file_name
  if (file.message_kind === MESSAGE_KIND_IMAGE) return 'Hình ảnh'
  return `(${file.zalo_msg_type})${file.file_ext ? `.${file.file_ext}` : ''}`
}
