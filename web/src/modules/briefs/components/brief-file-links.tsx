import { FileDown } from 'lucide-react'

import { formatFileSize } from '@/shared/utils/format-file-size'
import type { BriefFile } from '../types/brief'

/** Tệp PDF / Excel của báo cáo tuần / tháng — tải lại qua `download_url` (id bản tin + chỉ số, không có khóa lưu trữ thật). */
export function BriefFileLinks({ files }: { files: BriefFile[] }) {
  if (!files.length) return <p className="text-sm text-muted-foreground">Bản tin này không có tệp đính kèm.</p>

  return (
    <ul className="divide-y rounded-md border">
      {files.map((file) => (
        <li key={file.index} className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate" title={file.file_name}>
            {file.file_name}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(file.bytes)}</span>
          <a href={file.download_url} download className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline">
            <FileDown className="size-4" />
            Tải về
          </a>
        </li>
      ))}
    </ul>
  )
}
