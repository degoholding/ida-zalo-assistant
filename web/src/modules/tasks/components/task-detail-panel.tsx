import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { EventTimeline } from '@/shared/event-timeline/event-timeline'
import { appRoutes } from '@/shared/constants/app-routes'
import { Card } from '@/shared/ui/card'
import { Pill } from '@/shared/ui/pill'
import { SectionHeading } from '@/shared/ui/section-heading'
import { formatDateTime } from '@/shared/utils/format-date'
import { getTaskEventLabel, getTaskPriorityLabel, getTaskSourceLabel, TASK_STATUS, type TaskDetail } from '../types/task'
import { formatTaskDue } from '../utils/format-task-due'
import { TaskStatusBadge } from './task-status-badge'

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/** Thân trang chi tiết việc (khe `renderExtra` của `CrudDetailPage`, màn chỉ xem): thông tin + nhật ký. */
export function TaskDetailPanel({ task }: { task: TaskDetail }) {
  const resolutionLabel = task.status === TASK_STATUS.cancelled ? 'Lý do hủy' : 'Kết quả'
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="gap-2 p-4 sm:p-5">
          <SectionHeading>Thông tin</SectionHeading>
          <dl className="divide-y">
            <InfoRow label="Trạng thái">
              <TaskStatusBadge status={task.status} />
            </InfoRow>
            <InfoRow label="Người phụ trách">{task.assignee_name || <span className="text-muted-foreground">Chưa có</span>}</InfoRow>
            <InfoRow label="Người giao">{task.assigner_name || <span className="text-muted-foreground">Không rõ</span>}</InfoRow>
            <InfoRow label="Hạn">
              <span className={task.overdue ? 'font-medium text-destructive' : undefined}>{formatTaskDue(task.due_at, task.due_has_time)}</span>
              {task.overdue && (
                <Pill tone="danger" className="ml-2">
                  Quá hạn
                </Pill>
              )}
            </InfoRow>
            <InfoRow label="Ưu tiên">{getTaskPriorityLabel(task.priority) || '—'}</InfoRow>
            <InfoRow label="Nhóm">{task.source_thread_name || <span className="text-muted-foreground">Không gắn nhóm</span>}</InfoRow>
            <InfoRow label="Nguồn tạo">{getTaskSourceLabel(task.source) || '—'}</InfoRow>
            {task.source_thread_id && task.source_message_id && (
              <InfoRow label="Tin nguồn">
                <Link
                  to={appRoutes.conversations.message(task.source_thread_id, task.source_message_id)}
                  className="text-primary hover:underline"
                >
                  Xem tin nguồn
                </Link>
              </InfoRow>
            )}
          </dl>
        </Card>

        <Card className="gap-4 p-4 sm:p-5">
          <SectionHeading>Mốc thời gian</SectionHeading>
          <dl className="divide-y">
            <InfoRow label="Tạo lúc">{formatDateTime(task.created_at)}</InfoRow>
            <InfoRow label="Xác nhận">{formatDateTime(task.confirmed_at) || '—'}</InfoRow>
            <InfoRow label="Đóng lúc">{formatDateTime(task.closed_at) || '—'}</InfoRow>
            <InfoRow label="Cập nhật">{formatDateTime(task.updated_at)}</InfoRow>
          </dl>
          {task.resolution && (
            <>
              <SectionHeading>{resolutionLabel}</SectionHeading>
              <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{task.resolution}</p>
            </>
          )}
        </Card>
      </div>

      <EventTimeline events={task.events ?? []} getLabel={getTaskEventLabel} />
    </div>
  )
}
