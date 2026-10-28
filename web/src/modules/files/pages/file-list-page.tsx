import { useSearchParams } from 'react-router-dom'

import { CrudListPage } from '@/shared/crud/crud-list-page'
import { FileTabsBar } from '../components/file-tabs-bar'
import { fileCrudConfig } from '../config/file-crud'
import { sharedLinkCrudConfig } from '../config/shared-link-crud'
import { resolveFileTab, type FileTabKey } from '../utils/file-tabs'

/** Màn "Tệp": tab Tệp (tệp / ảnh / video trong kho) và tab Link chia sẻ (link bóc từ tin). */
export function FileListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = resolveFileTab(searchParams.get('tab'))
  // Đổi tab thì bỏ bộ lọc / trang của tab cũ — chỉ giữ `tab`
  const changeTab = (next: FileTabKey) => setSearchParams(next === 'files' ? {} : { tab: next }, { replace: true })
  const tabs = <FileTabsBar value={tab} onChange={changeTab} />

  // `key` riêng từng tab: hai bảng không dùng chung trạng thái (ô tìm, cột ẩn, trang)
  if (tab === 'links') return <CrudListPage key="links" config={sharedLinkCrudConfig} beforeContent={tabs} />
  return <CrudListPage key="files" config={fileCrudConfig} beforeContent={tabs} />
}
