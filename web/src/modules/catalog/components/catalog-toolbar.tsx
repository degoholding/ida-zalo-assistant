import { Download, RefreshCw, Upload } from 'lucide-react'
import { useState } from 'react'

import { usePermission } from '@/core/authorization/use-permission'
import { Button } from '@/shared/ui/button'
import { catalogApi } from '../api/catalog-api'
import { useRematchCatalog } from '../hooks/use-catalog-mutations'
import { CatalogImportDialog } from './catalog-import-dialog'

/** Thanh công cụ màn danh mục: «Tải mẫu Excel» ai xem cũng bấm được; «Nạp danh mục» và «Khớp lại» chỉ người có quyền ghi (quản trị). */
export function CatalogToolbar() {
  const { can } = usePermission()
  const [importOpen, setImportOpen] = useState(false)
  const rematch = useRematchCatalog()
  const canWrite = can('catalog', 'write')

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void catalogApi.downloadTemplate()}>
        <Download />
        Tải mẫu Excel
      </Button>
      {canWrite && (
        <>
          <Button variant="outline" size="sm" onClick={() => rematch.mutate()} disabled={rematch.isPending}>
            <RefreshCw className={rematch.isPending ? 'animate-spin' : undefined} />
            Khớp lại
          </Button>
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <Upload />
            Nạp danh mục
          </Button>
          <CatalogImportDialog open={importOpen} onOpenChange={setImportOpen} />
        </>
      )}
    </>
  )
}
