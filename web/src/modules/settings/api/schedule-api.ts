import { apiGet } from '@/core/api'
import type { ScheduleStatus } from '../types/schedule'

export const scheduleApi = {
  list: () => apiGet<ScheduleStatus[]>('/api/schedules'),
}
