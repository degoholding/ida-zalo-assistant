import { FileText, Image as ImageIcon } from 'lucide-react'
import { useState } from 'react'

import { isImageFile, type FileRecord } from '../types/file'
import { getFileName } from '../utils/get-file-name'
import { FilePreviewDialog } from './file-preview-dialog'

/** Ô «Tệp» của bảng: bấm tên mở hộp thoại xem ảnh / thông tin tệp (không mở trang chi tiết của dòng). */
export function FileNameCell({ file }: { file: FileRecord }) {
  const [open, setOpen] = useState(false)
  const name = getFileName(file)
  const Icon = isImageFile(file) ? ImageIcon : FileText
  return (
    <>
      <button
        type="button"
        className="flex max-w-full min-w-0 items-center gap-1.5 text-left font-medium text-primary hover:underline"
        title={name}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
      </button>
      {open && <FilePreviewDialog file={file} open={open} onOpenChange={setOpen} />}
    </>
  )
}
