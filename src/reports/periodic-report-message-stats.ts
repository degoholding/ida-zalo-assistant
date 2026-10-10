import type { RowDataPacket } from "mysql2";
import { GROUP_NAME_SQL } from "../briefs/brief-row-helpers.js";
import { MessagePriority } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { BriefPeriod, BriefScope } from "../briefs/brief-types.js";
import type { GroupReportRow, MetricPair, PeriodicReportTotals } from "./periodic-report-types.js";

// Số liệu TIN của báo cáo tuần / tháng (phase 3) — đếm theo `scope.groupIds` (đã áp luật Mật ở brief-scope.ts), kỳ này
// SO VỚI kỳ trước (`period.previous`). «Còn mở tại mốc cutoff» (waitingOverdueOpen) dựng lại từ `due_at` / `handled_at`
// (xem `stillOpenOverdueAt` — review phase 8, M6: trước đây đọc `reply_state` HIỆN TẠI nên một cờ vừa xử lý xong SAU
// mốc cutoff của kỳ TRƯỚC lại bị coi như "đã đóng từ kỳ trước", làm mũi tên ▲▼ so kỳ sai) — đúng cho MỌI mốc trong
// quá khứ, không chỉ mốc «now» của kỳ hiện hành.

/** `m.group_id IN (...)` theo phạm vi; phạm vi rỗng → không khớp dòng nào (tránh `IN ()` lỗi cú pháp). */
function scopeFilter(scope: BriefScope, column: string): { sql: string; params: unknown[] } {
  if (!scope.groupIds.length) return { sql: "1 = 0", params: [] };
  return { sql: `${column} IN (?)`, params: [scope.groupIds] };
}

/** Trung vị + trung bình (phút) của một danh sách — mảng rỗng → 0 (không có gì để tính). Hàm thuần. */
export function medianAndAverage(minutes: number[]): { median: number; average: number } {
  if (!minutes.length) return { median: 0, average: 0 };
  const sorted = [...minutes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const average = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return { median: Math.round(median), average: Math.round(average) };
}

interface MessageCountRow {
  total: number;
  urgent: number;
  important: number;
}

async function messageCounts(db: Db, scope: BriefScope, from: Date, to: Date): Promise<MessageCountRow> {
  const filter = scopeFilter(scope, "m.group_id");
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN f.priority = ? THEN 1 ELSE 0 END) AS urgent,
       SUM(CASE WHEN f.priority = ? THEN 1 ELSE 0 END) AS important
     FROM message m LEFT JOIN message_flag f ON f.message_id = m.id
     WHERE ${filter.sql} AND m.sent_at >= ? AND m.sent_at < ? AND m.recalled_at IS NULL`,
    [MessagePriority.Urgent, MessagePriority.Important, ...filter.params, from, to]);
  const row = rows[0] ?? {};
  return { total: Number(row.total ?? 0), urgent: Number(row.urgent ?? 0), important: Number(row.important ?? 0) };
}

/**
 * Còn mở + quá hạn nhắc TẠI mốc `cutoff` — dựng lại từ `due_at` / `handled_at` thay vì đọc `reply_state` HIỆN TẠI
 * (review phase 8, M6): quá hạn trước/đúng `cutoff` VÀ (chưa xử lý HOẶC xử lý SAU `cutoff`). `due_at` chỉ gán cho cờ
 * dạng «chờ trả lời» (`saveDecision`, alert-store.ts) nên không cần kiểm thêm `reply_state` — đúng cho MỌI mốc trong
 * quá khứ (kỳ trước lẫn kỳ này), khác bản cũ: đọc trạng thái hiện tại khiến cờ vừa xử lý SAU mốc kỳ trước bị tính
 * nhầm là «đã đóng từ kỳ trước», làm mũi tên ▲▼ so kỳ sai.
 */
async function waitingOverdueOpenAt(db: Db, scope: BriefScope, cutoff: Date): Promise<number> {
  const filter = scopeFilter(scope, "f.group_id");
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM message_flag f JOIN message m ON m.id = f.message_id
     WHERE ${filter.sql} AND f.due_at IS NOT NULL AND f.due_at <= ? AND (f.handled_at IS NULL OR f.handled_at > ?) AND m.recalled_at IS NULL`,
    [...filter.params, cutoff, cutoff]);
  return Number(rows[0]?.total ?? 0);
}

/** Phút phản hồi (sent_at → handled_at) của các cờ ĐÃ XỬ LÝ trong [from, to) — nguồn cho trung vị / trung bình. */
async function responseMinutes(db: Db, scope: BriefScope, from: Date, to: Date): Promise<number[]> {
  const filter = scopeFilter(scope, "f.group_id");
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT TIMESTAMPDIFF(SECOND, m.sent_at, f.handled_at) / 60 AS minutes
     FROM message_flag f JOIN message m ON m.id = f.message_id
     WHERE ${filter.sql} AND f.handled_at IS NOT NULL AND f.handled_at >= ? AND f.handled_at < ?`,
    [...filter.params, from, to]);
  return rows.map((row) => Math.max(0, Number(row.minutes ?? 0)));
}

interface GroupCountRow {
  groupId: number;
  total: number;
  urgent: number;
}

/** Tin + khẩn theo nhóm trong [from, to). */
async function groupMessageCounts(db: Db, scope: BriefScope, from: Date, to: Date): Promise<GroupCountRow[]> {
  if (!scope.groupIds.length) return [];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT m.group_id AS group_id, COUNT(*) AS total, SUM(CASE WHEN f.priority = ? THEN 1 ELSE 0 END) AS urgent
     FROM message m LEFT JOIN message_flag f ON f.message_id = m.id
     WHERE m.group_id IN (?) AND m.sent_at >= ? AND m.sent_at < ? AND m.recalled_at IS NULL GROUP BY m.group_id`,
    [MessagePriority.Urgent, scope.groupIds, from, to]);
  return rows.map((row) => ({ groupId: Number(row.group_id), total: Number(row.total ?? 0), urgent: Number(row.urgent ?? 0) }));
}

/** Như `waitingOverdueOpenAt`, theo từng nhóm — xem ghi chú ở đó (M6). */
async function groupWaitingOverdueOpen(db: Db, scope: BriefScope, cutoff: Date): Promise<Map<number, number>> {
  if (!scope.groupIds.length) return new Map();
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT f.group_id AS group_id, COUNT(*) AS total FROM message_flag f JOIN message m ON m.id = f.message_id
     WHERE f.group_id IN (?) AND f.due_at IS NOT NULL AND f.due_at <= ? AND (f.handled_at IS NULL OR f.handled_at > ?) AND m.recalled_at IS NULL
     GROUP BY f.group_id`,
    [scope.groupIds, cutoff, cutoff]);
  return new Map(rows.map((row) => [Number(row.group_id), Number(row.total ?? 0)]));
}

async function groupResponseAverage(db: Db, scope: BriefScope, from: Date, to: Date): Promise<Map<number, number>> {
  if (!scope.groupIds.length) return new Map();
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT f.group_id AS group_id, AVG(TIMESTAMPDIFF(SECOND, m.sent_at, f.handled_at)) / 60 AS avg_minutes
     FROM message_flag f JOIN message m ON m.id = f.message_id
     WHERE f.group_id IN (?) AND f.handled_at IS NOT NULL AND f.handled_at >= ? AND f.handled_at < ?
     GROUP BY f.group_id`,
    [scope.groupIds, from, to]);
  return new Map(rows.map((row) => [Number(row.group_id), Math.round(Number(row.avg_minutes ?? 0))]));
}

async function groupNames(db: Db, groupIds: number[]): Promise<Map<number, string>> {
  if (!groupIds.length) return new Map();
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, ${GROUP_NAME_SQL} AS name FROM zalo_group g WHERE id IN (?)`, [groupIds]);
  return new Map(rows.map((row) => [Number(row.id), String(row.name ?? "")]));
}

export interface MessageStatsResult {
  totals: Pick<PeriodicReportTotals, "messages" | "urgent" | "important" | "waitingOverdueOpen" | "responseMedianMinutes" | "responseAverageMinutes">;
  groups: GroupReportRow[];
  /** «Mọi nhóm» hay tên các nhóm đã chọn — cho khuôn PDF ghi đầu trang. */
  scopeLabel: string;
}

const pair = (current: number, previous: number): MetricPair => ({ current, previous });

/**
 * Số liệu tin của kỳ (tổng + theo nhóm), so với kỳ trước — một hàm gom đủ cho `PeriodicReportData`. `now` = mốc
 * «còn mở» của kỳ NÀY (report chạy ngay sau khi kỳ kết thúc nên lệch vài giờ so `period.to`); kỳ TRƯỚC dùng
 * `period.previous.to` (mốc cắt kỳ, không có mốc «chạy báo cáo» trong quá khứ để so).
 */
export async function collectMessageStats(db: Db, scope: BriefScope, period: BriefPeriod, now: Date): Promise<MessageStatsResult> {
  const [current, previous, waitingNow, waitingPrev, responseNow, responsePrev,
    groupNow, groupPrev, groupWaitingNow, groupResponseNow, names] = await Promise.all([
    messageCounts(db, scope, period.from, period.to),
    messageCounts(db, scope, period.previous.from, period.previous.to),
    waitingOverdueOpenAt(db, scope, now),
    waitingOverdueOpenAt(db, scope, period.previous.to),
    responseMinutes(db, scope, period.from, period.to),
    responseMinutes(db, scope, period.previous.from, period.previous.to),
    groupMessageCounts(db, scope, period.from, period.to),
    groupMessageCounts(db, scope, period.previous.from, period.previous.to),
    groupWaitingOverdueOpen(db, scope, now),
    groupResponseAverage(db, scope, period.from, period.to),
    groupNames(db, scope.groupIds),
  ]);
  const responseCurrent = medianAndAverage(responseNow);
  const responsePrevious = medianAndAverage(responsePrev);

  const prevByGroup = new Map(groupPrev.map((row) => [row.groupId, row.total]));
  const groupIds = new Set([...groupNow.map((row) => row.groupId), ...groupPrev.map((row) => row.groupId)]);
  const groups: GroupReportRow[] = [...groupIds].map((groupId) => {
    const nowRow = groupNow.find((row) => row.groupId === groupId);
    return {
      groupName: names.get(groupId) ?? `#${groupId}`,
      messages: nowRow?.total ?? 0,
      previousMessages: prevByGroup.get(groupId) ?? 0,
      urgent: nowRow?.urgent ?? 0,
      waitingOverdueOpen: groupWaitingNow.get(groupId) ?? 0,
      responseAverageMinutes: groupResponseNow.get(groupId) ?? 0,
    };
  }).sort((a, b) => b.messages - a.messages);

  const scopeLabel = scope.includeUngrouped
    ? "Mọi nhóm"
    : [...names.values()].filter(Boolean).sort((a, b) => a.localeCompare(b, "vi")).join(", ") || "(chưa chọn nhóm)";

  return {
    totals: {
      messages: pair(current.total, previous.total),
      urgent: pair(current.urgent, previous.urgent),
      important: pair(current.important, previous.important),
      waitingOverdueOpen: pair(waitingNow, waitingPrev),
      responseMedianMinutes: pair(responseCurrent.median, responsePrevious.median),
      responseAverageMinutes: pair(responseCurrent.average, responsePrevious.average),
    },
    groups,
    scopeLabel,
  };
}
