import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { AssistantTurnStatus, ContactKind, ConversationType, GroupKind, MessageKind } from "../constants.js";
import type { Db } from "../db/pool.js";
import { toVnIso } from "../data-access/vn-time.js";
import { vnMidnight, type WorkCalendar } from "../schedule/work-calendar.js";
import { computeReplyStats, emptyReplyStats, type EpisodeMessage, type ReplyStats } from "./reply-episodes.js";

// Chỉ số phản hồi (phase 15): đọc tin từng cuộc trong cửa sổ ngày, chạy lõi `computeReplyStats`, ghi lại bảng reply_metric_daily
// (xóa các ngày trong cửa sổ của cuộc rồi ghi mới — chạy lại bao nhiêu lần cũng ra cùng kết quả). Nhân viên = Danh bạ loại
// Nhân viên + mọi tài khoản bot; chat riêng: chủ tài khoản (owner_bot_id) là nhân viên. Nhóm nội bộ (group_kind = Internal) bỏ qua
// vì không có khách. Tin trước cửa sổ SEED_DAYS ngày chỉ để biết có lượt nào đang mở từ trước.

const SEED_DAYS = 3;
const DAY_MS = 86_400_000;

export interface ReplyMetricsRunOptions {
  /** 'YYYY-MM-DD' giờ VN, bao gồm cả hai đầu. */
  fromDay: string;
  toDay: string;
  now: Date;
  calendar: WorkCalendar | null;
  /** Ngưỡng trễ (phút làm việc) — alerts.replyWaitMinutes. */
  slaMinutes: number;
  onProgress?: (line: string) => void;
}

export interface ReplyMetricsRunResult {
  threads: number;
  rows: number;
}

interface ThreadRow extends RowDataPacket {
  id: number;
  thread_type: number;
  owner_bot_id: number | null;
}

const vnDay = (at: Date) => toVnIso(at).slice(0, 10);

export async function loadStaffUids(db: Db): Promise<Set<string>> {
  const [contacts] = await db.query<RowDataPacket[]>("SELECT zalo_uid FROM contact WHERE kind = ?", [ContactKind.Staff]);
  const [bots] = await db.query<RowDataPacket[]>("SELECT zalo_uid FROM bot_account WHERE zalo_uid IS NOT NULL AND zalo_uid <> ''");
  return new Set([...contacts, ...bots].map((row) => String(row.zalo_uid)));
}

async function botUidById(db: Db): Promise<Map<number, string>> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT id, zalo_uid FROM bot_account WHERE zalo_uid IS NOT NULL AND zalo_uid <> ''");
  return new Map(rows.map((row) => [Number(row.id), String(row.zalo_uid)]));
}

function statsValues(groupId: number, day: string, responderUid: string, responderName: string, stats: ReplyStats, assistantReplies: number, sla: number): unknown[] {
  return [
    groupId, day, responderUid, responderName.slice(0, 255), stats.customerMessages, stats.episodes, stats.answered, stats.answeredLate,
    stats.openEpisodes, stats.openOverdue, stats.waitSumSec, stats.waitMaxSec, stats.workWaitSumSec, stats.workWaitMaxSec, stats.staffMessages,
    assistantReplies, sla,
  ];
}

const INSERT_SQL = `INSERT INTO reply_metric_daily (group_id, metric_date, responder_uid, responder_name, customer_messages, episodes, answered,
  answered_late, open_episodes, open_overdue, wait_sum_sec, wait_max_sec, work_wait_sum_sec, work_wait_max_sec, staff_messages, assistant_replies,
  sla_minutes) VALUES ?`;

/** Tính lại chỉ số phản hồi cho mọi cuộc có tin trong [fromDay, toDay]. */
export async function recomputeReplyMetrics(db: Db, options: ReplyMetricsRunOptions): Promise<ReplyMetricsRunResult> {
  const start = vnMidnight(options.fromDay);
  const end = new Date(vnMidnight(options.toDay).getTime() + DAY_MS);
  if (start.getTime() >= end.getTime()) throw new Error("fromDay phải trước hoặc bằng toDay");
  const seedStart = new Date(start.getTime() - SEED_DAYS * DAY_MS);
  const staffUids = await loadStaffUids(db);
  const botUids = await botUidById(db);
  const [threads] = await db.query<ThreadRow[]>(
    `SELECT DISTINCT g.id, g.thread_type, g.owner_bot_id FROM zalo_group g JOIN message m ON m.group_id = g.id
     WHERE m.sent_at >= ? AND m.sent_at < ? AND NOT (g.thread_type = ? AND g.group_kind = ?) ORDER BY g.id`,
    [start, end, ConversationType.Group, GroupKind.Internal]);
  const workingMinutesBetween = options.calendar ? (from: Date, to: Date) => options.calendar!.workingMinutesBetween(from, to) : null;
  let rows = 0;
  for (const thread of threads) {
    const ownerUid = thread.thread_type === ConversationType.Direct && thread.owner_bot_id ? botUids.get(Number(thread.owner_bot_id)) ?? null : null;
    const isStaff = (uid: string) => uid === ownerUid || staffUids.has(uid);
    const [messageRows] = await db.query<RowDataPacket[]>(
      `SELECT sender_uid, sender_name, sent_at FROM message WHERE group_id = ? AND sent_at >= ? AND sent_at < ? AND recalled_at IS NULL AND kind <> ?
       ORDER BY sent_at, id`, [thread.id, seedStart, end, MessageKind.System]);
    const messages: EpisodeMessage[] = messageRows.map((row) => ({ sentAt: new Date(row.sent_at as Date), senderUid: String(row.sender_uid), senderName: String(row.sender_name ?? "") }));
    const result = computeReplyStats(messages, {
      now: options.now, slaMinutes: options.slaMinutes, isStaff, workingMinutesBetween, dayOf: vnDay, fromDay: options.fromDay,
    });
    const [assistantRows] = await db.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+07:00'), '%Y-%m-%d') AS d, COUNT(*) AS n FROM assistant_turn
       WHERE thread_id = ? AND status = ? AND created_at >= ? AND created_at < ? GROUP BY d`, [thread.id, AssistantTurnStatus.Answered, start, end]);
    const assistantByDay = new Map(assistantRows.map((row) => [String(row.d), Number(row.n) || 0]));
    const values: unknown[][] = [];
    const days = new Set([...result.byDay.keys(), ...assistantByDay.keys()].filter((day) => day >= options.fromDay && day <= options.toDay));
    for (const day of days) {
      const stats = result.byDay.get(day);
      if (!stats && !assistantByDay.get(day)) continue;
      values.push(statsValues(thread.id, day, "", "", stats ?? emptyReplyStats(), assistantByDay.get(day) ?? 0, options.slaMinutes));
    }
    for (const [key, stats] of result.byResponderDay) {
      const day = key.split("\u0000")[0];
      if (day < options.fromDay || day > options.toDay) continue;
      values.push(statsValues(thread.id, day, stats.responderUid, stats.responderName, stats, 0, options.slaMinutes));
    }
    await db.query<ResultSetHeader>("DELETE FROM reply_metric_daily WHERE group_id = ? AND metric_date BETWEEN ? AND ?", [thread.id, options.fromDay, options.toDay]);
    if (values.length) await db.query<ResultSetHeader>(INSERT_SQL, [values]);
    rows += values.length;
    options.onProgress?.(`cuộc #${thread.id}: ${messages.length} tin, ${values.length} dòng`);
  }
  return { threads: threads.length, rows };
}

/** Cửa sổ mặc định của việc nền: hôm qua + hôm nay (giờ VN) — lượt mở hôm qua được trả lời hôm nay cập nhật đúng ngày mở. */
export function defaultReplyMetricsWindow(now: Date): { fromDay: string; toDay: string } {
  return { fromDay: vnDay(new Date(now.getTime() - DAY_MS)), toDay: vnDay(now) };
}

/** Cửa sổ N ngày tới hôm nay cho lệnh tính bù. */
export function backfillReplyMetricsWindow(now: Date, days: number): { fromDay: string; toDay: string } {
  const span = Math.max(1, Math.min(400, Math.floor(days)));
  return { fromDay: vnDay(new Date(now.getTime() - (span - 1) * DAY_MS)), toDay: vnDay(now) };
}
