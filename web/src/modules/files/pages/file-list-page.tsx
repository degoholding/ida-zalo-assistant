import { CrudListPage } from '@/shared/crud/crud-list-page'
import { fileCrudConfig } from '../config/file-crud'

export function FileListPage() {
  return <CrudListPage config={fileCrudConfig} />
}
