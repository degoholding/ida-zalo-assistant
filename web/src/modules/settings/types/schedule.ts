/** Trạng thái lượt chạy gần nhất — chép từ `ScheduleRunStatus` ở `src/constants.ts` phía máy chủ. */
export const ScheduleRunStatus = {
  NeverRun: 0,
  Running: 1,
  Done: 2,
  Failed: 3,
} as const

export type ScheduleRunStatus = (typeof ScheduleRunStatus)[keyof typeof ScheduleRunStatus]

/** Một việc chạy theo lịch như `GET /api/schedules` trả về. */
export interface ScheduleStatus {
  name: string
  label: string
  /** Mô tả lịch bằng chữ, vd «hằng ngày 02:00». */
  schedule: string
  lastStartedAt: string | null
  lastFinishedAt: string | null
  lastStatus: ScheduleRunStatus
  /** Rỗng khi lượt gần nhất không lỗi. */
  lastError: string
  lastDurationMs: number
}
