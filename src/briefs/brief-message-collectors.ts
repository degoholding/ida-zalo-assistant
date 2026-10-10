import type { RowDataPacket } from "mysql2";
import { MessageKind, MessagePriority, ReplyState } from "../constants.js";
import type { Db } from "../db/pool.js";
import { maskPersonalData } from "../privacy/personal-data.js";
import { GROUP_NAME_SQL, toBriefLine } from "./brief-row-helpers.js";
import type { BriefLine, BriefPeriod, BriefScope, Bucket } from "./brief-types.js";

// Bộ gom tin cho bản tin: khẩn / quan trọng chưa xử lý, khẩn đã xử lý (đếm), tin chờ quá giờ / còn chờ, ứng viên điểm
// tin AI. Chỉ nhận BriefScope (không tự đọc all_groups / is_confidential — luật phạm vi nằm ở brief-scope.ts, Security).
//
// «Đã xử lý» (IDA câu 8, chốt 09/10/2026) = handled_at có giá trị. Cột này được ghi cho CẢ BA trường hợp: trả lời trích
// dẫn đúng tin, nhắc tên người gửi (closeAnsweredFlags → markFlagHandled, kể cả tin khẩn «không cần chờ» — openFlagSql),
// và đánh dấu tay «xong tin số …» (alert-tools) — nên gom về MỘT điều kiện (HANDLED_SQL).
const HANDLED_SQL = "f.handled_at IS NOT NULL";

const LINE_COLUMNS = `m.id, ${GROUP_NAME_SQL} AS group_name, m.sender_name, m.sent_at AS at, m.text`;

const clampText = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** `AND m.group_id IN (...)` theo phạm vi; danh sách rỗng → không khớp dòng nào (thay vì `IN ()` lỗi cú pháp). */
function scopeSql(scope: BriefScope): { sql: string; params: unknown[] } {
  if (!scope.groupIds.length) return { sql: "AND 1 = 0", params: [] };
  return { sql: "AND m.group_id IN (?)", params: [scope.groupIds] };
}

/** Đếm riêng (không bị LIMIT) rồi lấy top N — cùng `where` cho cả hai câu. */
async function messageBucket(db: Db, where: string, params: unknown[], orderSql: string, limit: number): Promise<Bucket<BriefLine>> {
  const [countRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM message_flag f JOIN message m ON m.id = f.message_id WHERE ${where}`, params);
  const total = Number(countRows[0]?.total ?? 0);
  if (!total) return { total: 0, items: [] };
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${LINE_COLUMNS} FROM message_flag f JOIN message m ON m.id = f.message_id JOIN zalo_group g ON g.id = m.group_id
     WHERE ${where} ORDER BY ${orderSql} LIMIT ?`, [...params, limit]);
  return { total, items: rows.map(toBriefLine) };
}

/** Khẩn chưa xử lý «chưa thì hiện tiếp» ở bản tin sau (chốt 09/10/2026) — nhìn ngược tối đa ngần này theo `sent_at`,
 * KHÔNG khoanh theo kỳ (period), để tin khẩn từ hôm trước / vài ngày trước không rớt khỏi bản tin chỉ vì đã qua 1-2 lượt
 * gửi (review phase 8, H2). «Đã xử lý hôm nay» (mục đếm riêng) vẫn tính theo kỳ — xem `urgentHandledCount`. */
const URGENT_LOOKBACK_MS = 7 * 86_400_000;

/** KHẨN / QUAN TRỌNG chưa xử lý, theo phạm vi — bản tin mục (1). `for_uid` / `pending_ai` áp luật như alert-store.ts
 * (`pendingUrgentItems`, review phase 8 H3): tin KHẨN luôn báo bất kể gắn `for_uid` cho ai, tin QUAN TRỌNG chỉ hiện khi
 * không gắn riêng cho người khác; tin KHẨN còn đang chờ AI xác nhận (`pending_ai = 1`) chưa tính là khẩn thật. */
export function urgentOpen(db: Db, scope: BriefScope, now: Date, limit = 20): Promise<Bucket<BriefLine>> {
  const scopeFilter = scopeSql(scope);
  const since = new Date(now.getTime() - URGENT_LOOKBACK_MS);
  const where = `f.priority IN (?, ?) AND NOT (${HANDLED_SQL}) AND m.recalled_at IS NULL AND m.sent_at > ?
    AND (f.priority != ? OR f.pending_ai = 0) AND (f.for_uid IS NULL OR f.for_uid = ? OR f.priority = ?) ${scopeFilter.sql}`;
  const params = [MessagePriority.Urgent, MessagePriority.Important, since,
    MessagePriority.Urgent, scope.uid, MessagePriority.Urgent, ...scopeFilter.params];
  return messageBucket(db, where, params, "f.priority DESC, m.sent_at", limit);
}

/** Số tin KHẨN (không gồm quan trọng) đã xử lý trong kỳ, theo phạm vi — chỉ đếm, không cần danh sách. */
export async function urgentHandledCount(db: Db, scope: BriefScope, period: BriefPeriod): Promise<number> {
  const scopeFilter = scopeSql(scope);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM message_flag f JOIN message m ON m.id = f.message_id
     WHERE f.priority = ? AND ${HANDLED_SQL} AND m.sent_at >= ? AND m.sent_at < ? ${scopeFilter.sql}`,
    [MessagePriority.Urgent, period.from, period.to, ...scopeFilter.params]);
  return Number(rows[0]?.total ?? 0);
}

/** Tin chờ dành cho MỘT người nhận khác (VIP / nhắc tên — cột for_uid) không vào bản tin của người này (như overdueItems). */
const FOR_RECIPIENT_SQL = "AND (f.for_uid IS NULL OR f.for_uid = ?)";

/**
 * Tin chờ trả lời đã quá giờ nhắc TẠI THỜI ĐIỂM HIỆN TẠI (không lọc theo kỳ, không loại tin đã bị trần báo / ngày
 * nuốt như `overdueItems` của alert-store — bản tin phải thấy đủ, xem phase-01 Key insights).
 */
export function waitingOverdue(db: Db, scope: BriefScope, now: Date, limit = 20): Promise<Bucket<BriefLine>> {
  const scopeFilter = scopeSql(scope);
  const where = `f.reply_state IN (?, ?) AND f.due_at IS NOT NULL AND f.due_at <= ? AND m.recalled_at IS NULL ${FOR_RECIPIENT_SQL} ${scopeFilter.sql}`;
  return messageBucket(db, where, [ReplyState.Waiting, ReplyState.Seen, now, scope.uid, ...scopeFilter.params], "f.due_at", limit);
}

/** Tin còn chờ trả lời nhưng CHƯA quá giờ nhắc — phần còn lại của hàng chờ (bù với `waitingOverdue`). */
export function waitingOpen(db: Db, scope: BriefScope, now: Date, limit = 20): Promise<Bucket<BriefLine>> {
  const scopeFilter = scopeSql(scope);
  const where = `f.reply_state IN (?, ?) AND (f.due_at IS NULL OR f.due_at > ?) AND m.recalled_at IS NULL ${FOR_RECIPIENT_SQL} ${scopeFilter.sql}`;
  return messageBucket(db, where, [ReplyState.Waiting, ReplyState.Seen, now, scope.uid, ...scopeFilter.params], "f.due_at IS NULL, f.due_at, m.sent_at DESC", limit);
}

const AI_CANDIDATE_LIMIT = 200;
const AI_SNIPPET_MAX = 300;

/**
 * Tin ứng viên cho điểm tin AI: nhóm `aiGroupIds` (đã bỏ Mật), kiểu Text / Link, ≥ 15 ký tự, không phải bot, trong
 * kỳ — ưu tiên tin đã có cờ (khẩn / quan trọng / AI), rồi tới nhóm đang sôi động (nhiều tin trong kỳ). Trần 200 tin;
 * che dữ liệu cá nhân TRƯỚC khi cắt còn tối đa 300 ký tự (review phase 8, Low) — che sau khi cắt có thể cắt đứt giữa
 * một số SĐT / STK / CCCD, khiến nửa còn lại không khớp mẫu che được nữa và lọt nguyên văn sang mô hình AI.
 */
export async function aiCandidates(db: Db, scope: BriefScope, period: BriefPeriod, limit = AI_CANDIDATE_LIMIT): Promise<BriefLine[]> {
  if (!scope.aiGroupIds.length) return [];
  const [botRows] = await db.query<RowDataPacket[]>("SELECT zalo_uid FROM bot_account WHERE zalo_uid IS NOT NULL");
  const botUids = botRows.map((row) => String(row.zalo_uid));
  const notBotSql = botUids.length ? "AND m.sender_uid NOT IN (?)" : "";
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${LINE_COLUMNS}, (f.message_id IS NOT NULL) AS flagged, COALESCE(gc.cnt, 0) AS group_activity
     FROM message m
     JOIN zalo_group g ON g.id = m.group_id
     LEFT JOIN message_flag f ON f.message_id = m.id
     LEFT JOIN (
       SELECT group_id, COUNT(*) AS cnt FROM message WHERE group_id IN (?) AND sent_at >= ? AND sent_at < ? GROUP BY group_id
     ) gc ON gc.group_id = m.group_id
     WHERE m.group_id IN (?) AND m.kind IN (?, ?) AND CHAR_LENGTH(COALESCE(m.text, '')) >= 15 AND m.recalled_at IS NULL
       AND m.sent_at >= ? AND m.sent_at < ? ${notBotSql}
     ORDER BY flagged DESC, group_activity DESC, m.sent_at DESC
     LIMIT ?`,
    [scope.aiGroupIds, period.from, period.to, scope.aiGroupIds, MessageKind.Text, MessageKind.Link, period.from, period.to,
      ...(botUids.length ? [botUids] : []), limit]);
  return rows.map((row) => ({ ...toBriefLine(row), text: clampText(maskPersonalData(String(row.text ?? "")), AI_SNIPPET_MAX) }));
}
