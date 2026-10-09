import crypto from "node:crypto";
import type { RowDataPacket } from "mysql2";
import type { AppConfig } from "../config.js";
import { AlertKind, TaskEventKind, TaskRemindStage, TaskStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { loadAlertSetup, recordAlertBatch, remindersSentToday, watchesGroup } from "../alerts/alert-store.js";
import { createLogger } from "../logger.js";
import { enqueueContactMessage, type MessageQueueDeps } from "../messaging/contact-message.js";
import { enqueueRecipientMessage } from "../recipients/recipient-repository.js";
import type { WorkCalendar } from "../schedule/work-calendar.js";
import { notifyTaskParty } from "./task-notify.js";
import { composeAssigneeReminder, composeOverdueReport, nextReminderStage, type ReminderItem } from "./task-reminder-plan.js";
import { recordTaskEvent, TASK_COLUMNS, toTask, type TaskParty } from "./task-repository.js";
import { rejectTask } from "./task-service.js";

// Bộ chạy nhắc hạn (phase 7) — worker mỗi phút (src/background.ts «task-reminders»). Mốc nào tới thì xem task-reminder-plan.ts.
// Không nhắc trong giờ yên lặng / ngày nghỉ (lượt đầu giờ làm kế tiếp nhắc dồn). Gửi qua hàng đợi (app giữ phiên Zalo gửi):
//   - người phụ trách: MỘT tin gộp mọi việc của họ trong cùng nhóm, tag trong nhóm (không ở nhóm → nhắn riêng); việc chưa có
//     người phụ trách thì nhắc người giao;
//   - QUÁ HẠN: thêm người giao (nhắn riêng) + sếp theo dõi nhóm đó (chung trần «N lần báo / ngày» với nhắc tin chờ).
// Xếp tin TRƯỚC rồi mới ghi «đã nhắc»: chết giữa chừng thì lượt sau xếp lại cùng khóa chống trùng — không mất, không gửi đôi.
// Khóa chống trùng gồm cả HẠN + NGƯỜI PHỤ TRÁCH hiện tại (review 09/10/2026): khóa của hàng đợi giữ 14 ngày, dời hạn / giao lại
// rồi tới cùng mốc mà khóa y hệt thì tin nhắc mới bị nuốt im lặng.

const log = createLogger("task-remind");
/** Mốc «trước hạn» sớm nhất có thể (kỳ nghỉ dài) — chỉ xét việc có hạn trong ngần này ngày tới */
const LOOKAHEAD_DAYS = 21;
const BATCH = 500;
/** ~2 ngày làm việc (lịch IDA 7,5 giờ làm / ngày) */
const PROPOSAL_TTL_WORK_MINUTES = 2 * 450;

const hashKey = (parts: string[]) => crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 20);
/** Khóa chống trùng của một lượt nhắc: việc + mốc + hạn + người phụ trách hiện tại. */
const cycleKey = (items: ReminderItem[]) =>
  hashKey(items.map(({ task, stage }) => `${task.id}:${stage}:${task.due_at?.getTime() ?? ""}:${task.assignee?.uid ?? ""}`));

async function threadNames(db: Db, ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const [rows] = await db.query<RowDataPacket[]>("SELECT id, COALESCE(NULLIF(label, ''), name) AS name FROM zalo_group WHERE id IN (?)", [ids]);
  return new Map(rows.map((row) => [Number(row.id), String(row.name ?? "")]));
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return map;
}

/**
 * Báo sếp các việc quá hạn trong nhóm họ theo dõi — trong trần ngày. Vượt trần thì lượt này KHÔNG báo sếp (người phụ trách +
 * người giao vẫn được báo; sếp xem «việc quá hạn» / màn Việc). Chưa có bản tin gom phần bị trần (phase 8).
 */
async function reportOverdueToRecipients(db: Db, config: AppConfig, overdue: ReminderItem[], names: Map<number, string>, now: Date): Promise<number> {
  if (!overdue.length || !config.alerts.enabled || config.alerts.dailyReminderCap <= 0) return 0;
  const setup = await loadAlertSetup(db, config);
  let sent = 0;
  for (const recipient of setup.recipients) {
    const items = overdue.filter(({ task }) => (task.source_thread_id ? watchesGroup(recipient, task.source_thread_id) : recipient.groupIds === null)
      // Người giao / người phụ trách đã được báo riêng
      && recipient.uid !== task.assigner.uid && recipient.uid !== task.assignee?.uid);
    if (!items.length) continue;
    if (await remindersSentToday(db, recipient.id, now) >= config.alerts.dailyReminderCap) continue;
    const queued = await enqueueRecipientMessage(db, { recipientId: recipient.id, text: composeOverdueReport(items, now, names, false) },
      `taskoverdue:r${recipient.id}:${cycleKey(items)}`);
    if (!queued) continue;
    await recordAlertBatch(db, recipient.id, AlertKind.TaskOverdue, items.map(({ task }) => task.id));
    sent += 1;
  }
  return sent;
}

/** Đề xuất (AI bắt) không ai xác nhận sau ~2 ngày làm việc thì tự bỏ — không nhắc lại, không báo ai. */
export async function expireStaleProposals(db: Db, calendar: WorkCalendar, now: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${TASK_COLUMNS} FROM task t WHERE t.tenant_id = 1 AND t.status = ? AND t.created_at < ? ORDER BY t.id LIMIT 200`,
    [TaskStatus.Proposed, new Date(now.getTime() - 86_400_000)]);
  let expired = 0;
  for (const row of rows) {
    const task = toTask(row);
    const expiresAt = calendar.addWorkingMinutes(task.created_at, PROPOSAL_TTL_WORK_MINUTES);
    if (!expiresAt || expiresAt.getTime() > now.getTime()) continue;
    await rejectTask({ db }, task, { contactId: null, uid: null, name: "Bot", via: "system" }, true);
    expired += 1;
  }
  if (expired) log.info(`tự bỏ ${expired} đề xuất việc không ai xác nhận`);
  return expired;
}

export async function runTaskReminders(db: Db, config: AppConfig, calendar: WorkCalendar | null, now = new Date()): Promise<number> {
  if (!calendar) return 0;
  await expireStaleProposals(db, calendar, now);
  if (calendar.isQuietTime(now)) return 0;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${TASK_COLUMNS}, t.updated_at FROM task t
     WHERE t.tenant_id = 1 AND t.status = ? AND t.due_at IS NOT NULL AND t.remind_stage < ? AND t.due_at <= ?
     ORDER BY t.due_at LIMIT ?`,
    [TaskStatus.Open, TaskRemindStage.Overdue, new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000), BATCH]);
  const due: ReminderItem[] = rows.flatMap((row) => {
    const task = toTask(row);
    const stage = nextReminderStage({ ...task, baseline: new Date(row.updated_at) }, calendar, now);
    return stage ? [{ task, stage }] : [];
  });
  if (!due.length) return 0;
  const deps: MessageQueueDeps = { db };

  // Người phụ trách (không có thì người giao) — một tin / người / nhóm
  const target = (item: ReminderItem): TaskParty | null => (item.task.assignee?.uid ? item.task.assignee : item.task.assigner.uid ? item.task.assigner : null);
  for (const items of groupBy(due, (item) => `${target(item)?.uid ?? ""}|${item.task.source_thread_id ?? ""}`).values()) {
    const party = target(items[0]);
    if (party) await notifyTaskParty(deps, items[0].task, party, composeAssigneeReminder(items, now), `remind:${cycleKey(items)}`);
  }
  const overdue = due.filter((item) => item.stage === TaskRemindStage.Overdue);
  const names = await threadNames(db, [...new Set(overdue.flatMap(({ task }) => (task.source_thread_id ? [task.source_thread_id] : [])))]);
  // Người giao: việc họ giao (cho người khác) đã quá hạn — nhắn riêng
  const toAssigner = overdue.filter(({ task }) => task.assigner.uid && task.assignee?.uid && task.assignee.uid !== task.assigner.uid);
  for (const items of groupBy(toAssigner, ({ task }) => task.assigner.uid!).values()) {
    const assigner = items[0].task.assigner;
    await enqueueContactMessage(deps, { zaloUid: assigner.uid!, name: assigner.name, text: composeOverdueReport(items, now, names, true) },
      `taskoverdue:a:${assigner.uid}:${cycleKey(items)}`);
  }
  const recipients = await reportOverdueToRecipients(db, config, overdue, names, now);

  for (const { task, stage } of due) {
    // Chỉ ghi «đã nhắc» nếu hạn / người phụ trách chưa đổi trong lúc nhắc — dời hạn giữa chừng thì giữ mốc 0 cho hạn mới
    await db.query(
      "UPDATE task SET remind_stage = ? WHERE id = ? AND remind_stage < ? AND status = ? AND due_at <=> ? AND assignee_uid <=> ?",
      [stage, task.id, stage, TaskStatus.Open, task.due_at, task.assignee?.uid ?? null]);
    await recordTaskEvent(db, task.id, TaskEventKind.Reminded, { name: "Bot", via: "system" },
      stage === TaskRemindStage.Overdue ? "nhắc quá hạn" : stage === TaskRemindStage.Due ? "nhắc tới hạn hôm nay" : "nhắc trước hạn");
  }
  log.info(`nhắc ${due.length} việc (${overdue.length} quá hạn)${recipients ? `, báo ${recipients} người nhận` : ""}`);
  return due.length;
}
