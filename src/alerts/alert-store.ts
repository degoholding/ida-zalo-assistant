import crypto from "node:crypto";
import type { RowDataPacket } from "mysql2";
import type { AppConfig } from "../config.js";
import { AlertKind, ConversationType, JobKind, JobStatus, MessagePriority, ReplyState } from "../constants.js";
import type { Db } from "../db/pool.js";
import { markFlagHandled, upsertMessageFlag } from "../flags/message-flags.js";
import { enqueueJob } from "../jobs/job-queue.js";
import type { WorkCalendar } from "../schedule/work-calendar.js";
import { parseKeywordList } from "./keyword-matcher.js";
import type { ClassifyContext, ClassifyDecision } from "./classifier.js";

// Phần CSDL của cảnh báo (phase 5): người nhận + phạm vi + VIP, ghi cờ, nhận ra tin đã được trả lời, gom tin khẩn /
// tin chờ quá giờ thành MỘT thông báo cho từng người nhận, ghi đã báo gì (alert_log) để không báo trùng và đếm trần.
// Dùng được ở cả hai tiến trình: app (lúc nhận tin, lúc gửi) và worker (nhắc theo lịch, AI xét theo lô).

export interface AlertRecipient {
  id: number;
  uid: string;
  name: string;
  /** null = mọi nhóm đang đọc */
  groupIds: Set<number> | null;
  vipUids: Set<string>;
  notifyUrgent: boolean;
}

export interface AlertSetup {
  context: ClassifyContext;
  recipients: AlertRecipient[];
}

/** Người nhận đang bật + VIP + uid bot, và bộ từ khóa theo cài đặt hiện hành. */
export async function loadAlertSetup(db: Db, config: AppConfig): Promise<AlertSetup> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT r.id, r.name, r.all_groups, r.notify_urgent, c.zalo_uid FROM recipient r JOIN contact c ON c.id = r.contact_id
     WHERE r.is_active = 1 ORDER BY r.rank_order, r.id`);
  const [groups] = await db.query<RowDataPacket[]>("SELECT recipient_id, group_id FROM recipient_group");
  const [vips] = await db.query<RowDataPacket[]>(
    "SELECT v.recipient_id, c.zalo_uid FROM recipient_vip v JOIN contact c ON c.id = v.contact_id");
  const [bots] = await db.query<RowDataPacket[]>("SELECT zalo_uid FROM bot_account WHERE zalo_uid IS NOT NULL");
  const recipients: AlertRecipient[] = rows.map((row) => ({
    id: Number(row.id), uid: String(row.zalo_uid), name: String(row.name), notifyUrgent: Boolean(row.notify_urgent),
    groupIds: row.all_groups ? null : new Set(groups.filter((g) => Number(g.recipient_id) === Number(row.id)).map((g) => Number(g.group_id))),
    vipUids: new Set(vips.filter((v) => Number(v.recipient_id) === Number(row.id)).map((v) => String(v.zalo_uid))),
  }));
  return {
    recipients,
    context: {
      keywords: {
        urgent: parseKeywordList(config.alerts.urgentKeywords),
        important: parseKeywordList(config.alerts.importantKeywords),
        strict: parseKeywordList(config.alerts.strictKeywords),
      },
      recipientUids: new Set(recipients.map((recipient) => recipient.uid)),
      vipUids: new Set(recipients.flatMap((recipient) => [...recipient.vipUids])),
      botUids: new Set(bots.map((row) => String(row.zalo_uid))),
    },
  };
}

export const watchesGroup = (recipient: AlertRecipient, groupId: number) => recipient.groupIds === null || recipient.groupIds.has(groupId);

/** Ghi cờ cho một tin theo kết quả phân loại; hạn nhắc tính theo GIỜ LÀM VIỆC. */
export async function saveDecision(
  db: Db, message: { id: number; groupId: number; sentAt: Date }, decision: ClassifyDecision, calendar: WorkCalendar | null, config: AppConfig,
): Promise<void> {
  const minutes = decision.wait === "vip" ? config.alerts.vipWaitMinutes : config.alerts.replyWaitMinutes;
  const dueAt = decision.wait ? (calendar?.addWorkingMinutes(message.sentAt, minutes) ?? new Date(message.sentAt.getTime() + minutes * 60_000)) : null;
  await upsertMessageFlag(db, {
    messageId: message.id, groupId: message.groupId, priority: decision.priority,
    replyState: decision.wait ? ReplyState.Waiting : ReplyState.NotNeeded, source: decision.source, reason: decision.reason, dueAt,
  });
  // for_uid / pending_ai: cột của phase 5 — upsertMessageFlag (phase 3) không biết, ghi riêng
  await db.query("UPDATE message_flag SET for_uid = COALESCE(for_uid, ?), pending_ai = ? WHERE message_id = ?",
    [decision.forUid, decision.pendingAi ? 1 : 0, message.id]);
}

/**
 * Một tin mới có làm tin đang chờ thành «đã xử lý» không (IDA câu 8): trả lời TRÍCH DẪN đúng tin đó, hoặc nhắc tên người
 * hỏi — bởi người khác người hỏi. Trả về số tin vừa đóng.
 */
export async function closeAnsweredFlags(
  db: Db, message: { id: number; groupId: number; senderUid: string; quoteZaloMsgId: string | null; mentionUids: string[]; sentAt: Date },
): Promise<number> {
  let closed = 0;
  if (message.quoteZaloMsgId) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT f.message_id FROM message_flag f JOIN message m ON m.id = f.message_id
       WHERE m.group_id = ? AND m.zalo_msg_id = ? AND m.sender_uid <> ? AND f.reply_state IN (?, ?)`,
      [message.groupId, message.quoteZaloMsgId, message.senderUid, ReplyState.Waiting, ReplyState.Seen]);
    for (const row of rows) if (await markFlagHandled(db, Number(row.message_id), message.senderUid, message.id, message.sentAt)) closed += 1;
  }
  const others = message.mentionUids.filter((uid) => uid !== message.senderUid);
  if (others.length) {
    // Nhắc tên người hỏi = đang trả lời người đó: đóng các tin của họ còn chờ trong nhóm (24 giờ gần nhất)
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT f.message_id FROM message_flag f JOIN message m ON m.id = f.message_id
       WHERE m.group_id = ? AND m.sender_uid IN (?) AND f.reply_state IN (?, ?) AND m.sent_at > ? AND m.id < ?`,
      [message.groupId, others, ReplyState.Waiting, ReplyState.Seen, new Date(message.sentAt.getTime() - 86_400_000), message.id]);
    for (const row of rows) if (await markFlagHandled(db, Number(row.message_id), message.senderUid, message.id, message.sentAt)) closed += 1;
  }
  return closed;
}

/**
 * Hẹn một lượt gom-và-báo tin khẩn cho người nhận. Đã có lượt đang chờ thì thôi (lượt đó sẽ gom luôn tin này). Tin khẩn
 * đầu tiên báo ngay; vừa báo xong thì lượt sau chờ hết `urgentMergeSeconds` (tin dồn trong khoảng đó gộp làm một).
 */
export async function scheduleUrgentDispatch(db: Db, recipientId: number, mergeSeconds: number, now = new Date()): Promise<boolean> {
  const serialKey = `alert:${recipientId}`;
  const [pending] = await db.query<RowDataPacket[]>(
    "SELECT 1 FROM job WHERE kind = ? AND serial_key = ? AND status = ? LIMIT 1", [JobKind.AlertDispatch, serialKey, JobStatus.Pending]);
  if (pending.length) return false;
  const [last] = await db.query<RowDataPacket[]>(
    "SELECT MAX(sent_at) AS at FROM alert_log WHERE recipient_id = ? AND kind = ?", [recipientId, AlertKind.Urgent]);
  const lastAt = last[0]?.at ? new Date(last[0].at).getTime() : 0;
  const runAfter = new Date(Math.max(now.getTime(), lastAt + mergeSeconds * 1000));
  await enqueueJob(db, { kind: JobKind.AlertDispatch, payload: { recipientId }, serialKey, runAfter, expiresInMs: 2 * 60 * 60_000, maxAttempts: 3 });
  return true;
}

export interface PendingAlertItem {
  messageId: number;
  groupId: number;
  groupName: string;
  senderName: string;
  sentAt: Date;
  text: string;
  reason: string;
}

function scopeSql(recipient: AlertRecipient): { sql: string; params: unknown[] } {
  if (recipient.groupIds === null) return { sql: "", params: [] };
  if (!recipient.groupIds.size) return { sql: "AND 1 = 0", params: [] };
  return { sql: "AND m.group_id IN (?)", params: [[...recipient.groupIds]] };
}

const ITEM_COLUMNS = `m.id, m.group_id, COALESCE(NULLIF(g.label, ''), g.name) AS group_name, m.sender_name, m.sent_at, m.text, f.reason`;
const toItem = (row: RowDataPacket): PendingAlertItem => ({
  messageId: Number(row.id), groupId: Number(row.group_id), groupName: String(row.group_name ?? ""), senderName: String(row.sender_name ?? ""),
  sentAt: new Date(row.sent_at), text: String(row.text ?? ""), reason: String(row.reason ?? ""),
});

/** Tin KHẨN (đã xác nhận) hoặc của VIP của người này, trong phạm vi, 24 giờ gần nhất, chưa báo cho người này. */
export async function pendingUrgentItems(db: Db, recipient: AlertRecipient, now = new Date(), limit = 20): Promise<PendingAlertItem[]> {
  const scope = scopeSql(recipient);
  const vips = [...recipient.vipUids];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${ITEM_COLUMNS} FROM message_flag f JOIN message m ON m.id = f.message_id JOIN zalo_group g ON g.id = m.group_id
     WHERE g.thread_type = ? AND g.read_messages = 1 AND m.recalled_at IS NULL AND m.sent_at > ? ${scope.sql}
       AND ((f.priority = ? AND f.pending_ai = 0) ${vips.length ? "OR m.sender_uid IN (?)" : ""})
       AND (f.for_uid IS NULL OR f.for_uid = ? OR f.priority = ?)
       AND NOT EXISTS (SELECT 1 FROM alert_log a WHERE a.recipient_id = ? AND a.message_id = m.id AND a.kind = ?)
     ORDER BY m.sent_at LIMIT ?`,
    [ConversationType.Group, new Date(now.getTime() - 86_400_000), ...scope.params, MessagePriority.Urgent, ...(vips.length ? [vips] : []),
      recipient.uid, MessagePriority.Urgent, recipient.id, AlertKind.Urgent, limit]);
  return rows.map(toItem);
}

/** Tin chờ trả lời đã quá hạn nhắc, trong phạm vi, dành cho người này (hoặc chung), chưa nhắc lần nào. */
export async function overdueItems(db: Db, recipient: AlertRecipient, now = new Date(), limit = 10): Promise<PendingAlertItem[]> {
  const scope = scopeSql(recipient);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${ITEM_COLUMNS} FROM message_flag f JOIN message m ON m.id = f.message_id JOIN zalo_group g ON g.id = m.group_id
     WHERE f.reply_state IN (?, ?) AND f.due_at IS NOT NULL AND f.due_at <= ? AND g.read_messages = 1 AND m.recalled_at IS NULL ${scope.sql}
       AND (f.for_uid IS NULL OR f.for_uid = ?)
       AND NOT EXISTS (SELECT 1 FROM alert_log a WHERE a.recipient_id = ? AND a.message_id = m.id AND a.kind = ?)
     ORDER BY f.priority DESC, f.due_at LIMIT ?`,
    [ReplyState.Waiting, ReplyState.Seen, now, ...scope.params, recipient.uid, recipient.id, AlertKind.Reminder, limit]);
  return rows.map(toItem);
}

/** Số LẦN đã nhắc (tin chờ) người này trong ngày giờ Việt Nam. */
export async function remindersSentToday(db: Db, recipientId: number, now = new Date()): Promise<number> {
  const dayStart = new Date(Math.floor((now.getTime() + 7 * 3_600_000) / 86_400_000) * 86_400_000 - 7 * 3_600_000);
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(DISTINCT batch_id) AS n FROM alert_log WHERE recipient_id = ? AND kind = ? AND sent_at >= ?",
    [recipientId, AlertKind.Reminder, dayStart]);
  return Number(rows[0]?.n ?? 0);
}

/** Ghi các tin đã báo trong MỘT thông báo (cùng batch_id). */
export async function recordAlertBatch(db: Db, recipientId: number, kind: AlertKind, messageIds: number[]): Promise<void> {
  if (!messageIds.length) return;
  const batchId = crypto.randomBytes(8).toString("hex");
  await db.query("INSERT IGNORE INTO alert_log (recipient_id, message_id, kind, batch_id) VALUES ?",
    [messageIds.map((id) => [recipientId, id, kind, batchId])]);
}

const VN_TIME = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", hour12: false });
const snippet = (text: string, max = 160) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Một dòng / tin trong thông báo gửi người nhận. */
function itemLine(item: PendingAlertItem, index: number, extra = ""): string {
  return `${index + 1}. [${item.groupName}] ${item.senderName} · ${VN_TIME.format(item.sentAt)}${extra}\n   ${snippet(item.text)}\n   (${item.reason})`;
}

export function composeUrgentAlert(items: PendingAlertItem[]): string {
  const head = items.length === 1 ? "KHẨN — 1 tin cần anh/chị xem ngay:" : `KHẨN — ${items.length} tin cần anh/chị xem ngay:`;
  return [head, ...items.map((item, index) => itemLine(item, index))].join("\n");
}

export function composeReminder(items: PendingAlertItem[], now = new Date()): string {
  const waited = (item: PendingAlertItem) => {
    const minutes = Math.max(0, Math.round((now.getTime() - item.sentAt.getTime()) / 60_000));
    return minutes >= 60 ? ` · chờ ${Math.floor(minutes / 60)} giờ ${minutes % 60} phút` : ` · chờ ${minutes} phút`;
  };
  return [`NHẮC — ${items.length} tin đang chờ trả lời quá giờ:`, ...items.map((item, index) => itemLine(item, index, waited(item))),
    "Trả lời trích dẫn đúng tin trong nhóm (hoặc nhắn em «xong tin số …») thì em thôi nhắc."].join("\n");
}
