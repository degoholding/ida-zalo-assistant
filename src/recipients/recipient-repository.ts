import type { RowDataPacket } from "mysql2";
import { JobKind } from "../constants.js";
import type { Db } from "../db/pool.js";
import { enqueueJob } from "../jobs/job-queue.js";

// Người nhận cảnh báo / bản tin (phase 4, IDA câu 1: Trưởng phòng, CEO, trưởng nhóm cùng nhận, theo thứ tự ưu tiên).
// Kênh báo = chat riêng giữa người nhận và tài khoản bot trên Zalo. Tiến trình nào cũng gửi được: ghi việc
// RecipientMessage vào hàng đợi, tiến trình app (giữ phiên Zalo) gửi đi.

export interface RecipientRow {
  id: number;
  tenant_id: number;
  contact_id: number;
  zalo_uid: string;
  name: string;
  title: string;
  rank_order: number;
  all_groups: number;
  morning_brief_at: string;
  evening_brief_at: string;
  notify_urgent: number;
  is_active: number;
}

const RECIPIENT_COLUMNS = `r.id, r.tenant_id, r.contact_id, c.zalo_uid, r.name, r.title, r.rank_order, r.all_groups,
  r.morning_brief_at, r.evening_brief_at, r.notify_urgent, r.is_active`;

/** Người nhận đang bật, theo thứ tự ưu tiên. */
export async function listActiveRecipients(db: Db, tenantId = 1): Promise<RecipientRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${RECIPIENT_COLUMNS} FROM recipient r JOIN contact c ON c.id = r.contact_id
     WHERE r.tenant_id = ? AND r.is_active = 1 ORDER BY r.rank_order, r.id`, [tenantId]);
  return rows as RecipientRow[];
}

export async function findRecipient(db: Db, recipientId: number): Promise<RecipientRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${RECIPIENT_COLUMNS} FROM recipient r JOIN contact c ON c.id = r.contact_id WHERE r.id = ?`, [recipientId]);
  return (rows[0] as RecipientRow | undefined) ?? null;
}

/** Người đang nhắn riêng cho bot có phải người nhận (đang bật) không — người nhận luôn được bot trả lời. */
export async function isActiveRecipientUid(db: Db, zaloUid: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT 1 FROM recipient r JOIN contact c ON c.id = r.contact_id WHERE c.zalo_uid = ? AND r.is_active = 1 LIMIT 1", [zaloUid]);
  return rows.length > 0;
}

/** Nhóm một người nhận theo dõi; null = mọi nhóm đang đọc. */
export async function recipientGroupIds(db: Db, recipient: Pick<RecipientRow, "id" | "all_groups">): Promise<number[] | null> {
  if (recipient.all_groups) return null;
  const [rows] = await db.query<RowDataPacket[]>("SELECT group_id FROM recipient_group WHERE recipient_id = ?", [recipient.id]);
  return rows.map((row) => Number(row.group_id));
}

export interface RecipientMessagePayload {
  recipientId: number;
  text: string;
}

/** Xếp một tin riêng cho người nhận vào hàng đợi (tiến trình app gửi). `dedupeKey` để một cảnh báo không gửi hai lần. */
export function enqueueRecipientMessage(db: Db, payload: RecipientMessagePayload, dedupeKey?: string): Promise<number | null> {
  return enqueueJob(db, {
    kind: JobKind.RecipientMessage, payload, dedupeKey, serialKey: `recipient:${payload.recipientId}`,
    // Báo trễ quá 2 giờ thì thôi — tin đó đã vào bản tin kế tiếp
    expiresInMs: 2 * 60 * 60_000, maxAttempts: 3,
  });
}
