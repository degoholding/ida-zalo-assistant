import { CrudDetailPage } from '@/shared/crud/crud-detail-page'
import { taskCrudConfig } from '../config/task-crud'

/** Chi tiết một việc — màn CHỈ XEM (`readOnlyDetail`), thao tác đi bằng hàng nút trên đầu trang. */
export function TaskDetailPage() {
  return <CrudDetailPage config={taskCrudConfig} />
}
