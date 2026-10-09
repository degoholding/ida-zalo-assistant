import { CrudListPage } from '@/shared/crud/crud-list-page'
import { taskCrudConfig } from '../config/task-crud'

/** Danh sách việc — checklist công việc giao qua bot / recap họp / AI rà soát, hoặc tạo thẳng trên web. */
export function TaskListPage() {
  return <CrudListPage config={taskCrudConfig} />
}
