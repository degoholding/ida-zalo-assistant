import { TaskRemindStage } from "../constants.js";
import { vnLocalTime, type WorkCalendar } from "../schedule/work-calendar.js";
import { formatDue, overdueLabel } from "./task-format.js";
import { shortTaskCode, type TaskRow } from "./task-repository.js";

// Nhắc hạn 3 mốc (phase 7, IDA câu 23). Hàm thuần — bộ chạy ở task-reminders.ts.
//   (1) Trước hạn: đầu giờ làm của NGÀY LÀM VIỆC liền trước ngày hạn (hạn T2 → T6 tuần trước 08:30).
//   (2) Đúng hạn: đầu giờ làm của ngày hạn («hôm nay tới hạn 17:00» — nhắc lúc 17:00 thì đã muộn để làm).
//   (3) Quá hạn: hạn có giờ → sau hạn 1 giờ làm việc; hạn chỉ có ngày → đầu giờ làm ngày làm việc kế tiếp.
// Chỉ gửi MỐC CAO NHẤT đã tới (bot tắt 3 ngày thì không gửi bù cả ba). Mốc (1)(2) đã qua TRƯỚC lúc việc được tạo / dời hạn /
// giao lại thì bỏ (vừa giao xong đã nhắc «sắp tới hạn» là thừa); mốc quá hạn thì luôn gửi.

const DAY_MS = 86_400_000;
const OVERDUE_GRACE_WORK_MINUTES = 60;

export interface ReminderStageTimes {
  dayBefore: Date | null;
  due: Date | null;
  overdue: Date | null;
}

const dayStartOf = (at: Date) => vnLocalTime(at).dayStartMs;

export function reminderStageTimes(dueAt: Date, hasTime: boolean, calendar: WorkCalendar): ReminderStageTimes {
  const dueDay = dayStartOf(dueAt);
  const deadline = hasTime ? dueAt : new Date(dueDay + DAY_MS);
  const dueStage = calendar.addWorkingMinutes(new Date(dueDay), 0);
  return {
    // previousWorkingDayStart nhấc lên WorkCalendar (DRY với kỳ bản tin sáng, phase 8)
    dayBefore: calendar.previousWorkingDayStart(new Date(dueDay)),
    // Hạn trước giờ vào làm / hạn rơi vào ngày nghỉ: «tới hạn hôm nay» sẽ tới SAU hạn — bỏ, để mốc quá hạn nói đúng
    due: dueStage && dueStage.getTime() < deadline.getTime() ? dueStage : null,
    overdue: calendar.addWorkingMinutes(deadline, hasTime ? OVERDUE_GRACE_WORK_MINUTES : 0) ?? deadline,
  };
}

export interface ReminderInput {
  due_at: Date | null;
  due_has_time: boolean;
  remind_stage: TaskRemindStage;
  /** Lúc việc được tạo / dời hạn / giao lại gần nhất (task.updated_at khi remind_stage về 0) */
  baseline: Date;
}

/** Mốc cần gửi BÂY GIỜ (cao nhất đã tới, chưa gửi), null nếu chưa có gì. */
export function nextReminderStage(task: ReminderInput, calendar: WorkCalendar, now: Date): TaskRemindStage | null {
  if (!task.due_at) return null;
  const times = reminderStageTimes(task.due_at, task.due_has_time, calendar);
  const stages: [TaskRemindStage, Date | null][] = [
    [TaskRemindStage.DayBefore, times.dayBefore], [TaskRemindStage.Due, times.due], [TaskRemindStage.Overdue, times.overdue],
  ];
  let best: TaskRemindStage | null = null;
  for (const [stage, at] of stages) {
    if (!at || stage <= task.remind_stage || at.getTime() > now.getTime()) continue;
    if (stage !== TaskRemindStage.Overdue && at.getTime() < task.baseline.getTime()) continue;
    best = stage;
  }
  return best;
}

export interface ReminderItem {
  task: TaskRow;
  stage: TaskRemindStage;
}

/** Một dòng nhắc: «- V-12 gửi báo giá — hạn 17:00 T6 16/10 (tới hạn hôm nay)». */
export function describeReminderLine(item: ReminderItem, now: Date, withAssignee = false): string {
  const { task, stage } = item;
  const tag = stage === TaskRemindStage.Overdue ? (overdueLabel(task, now) || "quá hạn").toUpperCase()
    : stage === TaskRemindStage.Due ? "tới hạn hôm nay" : "sắp tới hạn";
  const who = withAssignee ? ` — ${task.assignee?.name || "chưa có người phụ trách"}` : "";
  return `- ${shortTaskCode(task)} ${task.title}${who} — hạn ${formatDue(task.due_at, task.due_has_time, now)} (${tag})`;
}

/** Tin nhắc người phụ trách (một tin gộp mọi việc của họ trong cùng một nhóm). */
export function composeAssigneeReminder(items: ReminderItem[], now: Date): string {
  const overdue = items.some((item) => item.stage === TaskRemindStage.Overdue);
  const code = shortTaskCode(items[0].task);
  return [`nhắc việc${overdue ? " — có việc ĐÃ QUÁ HẠN" : ""}:`, ...items.map((item) => describeReminderLine(item, now)),
    `Xong thì nhắn «xong ${code}»; cần dời hạn thì báo người giao.`].join("\n");
}

/** Tin báo việc quá hạn cho người giao / sếp. `threadNames`: tên nhóm theo id. */
export function composeOverdueReport(items: ReminderItem[], now: Date, threadNames: Map<number, string>, forAssigner: boolean): string {
  const lines = items.map((item) => {
    const group = item.task.source_thread_id ? threadNames.get(item.task.source_thread_id) : "";
    return `${describeReminderLine(item, now, true)}${group ? ` [${group}]` : ""}`;
  });
  const code = shortTaskCode(items[0].task);
  return [forAssigner ? `VIỆC ANH/CHỊ GIAO ĐÃ QUÁ HẠN (${items.length})` : `VIỆC QUÁ HẠN (${items.length})`, ...lines, "",
    `Nhắn «${code}» để xem, «dời ${code} <hạn>», «giao lại ${code} <tên>» hoặc «hủy ${code}».`].join("\n");
}
