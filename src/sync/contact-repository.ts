import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { ContactKind, ContactKindSource, ConversationType, GroupKind } from "../constants.js";
import type { Db } from "../db/pool.js";

// Danh bạ: mọi người Zalo bot từng thấy. Ba đường ghi, mỗi đường chỉ đụng đúng phần của nó —
// không đường nào ghi đè loại / vai trò / công ty / ghi chú mà quản trị đã đặt tay.

export interface ContactRow {
  id: number;
  zalo_uid: string;
  display_name: string;
  zalo_name: string;
  kind: number;
  role: number;
  company_id: number | null;
}

type Executor = Db | PoolConnection;

/**
 * Người nhắn riêng cho bot: cập nhật tên + mốc nhắn gần nhất. KHÔNG đếm tin ở đây — tin có thể là tin
 * trùng (bù tin lỡ khi kết nối lại gửi lại cả tin đã có); đếm bằng countDirectMessage SAU khi lưu được.
 */
export async function recordDirectMessageContact(db: Db, zaloUid: string, displayName: string, sentAt: Date): Promise<ContactRow> {
  await db.query(
    `INSERT INTO contact (zalo_uid, display_name, last_dm_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_name = IF(VALUES(display_name) = '', display_name, VALUES(display_name)),
       last_dm_at = GREATEST(COALESCE(last_dm_at, VALUES(last_dm_at)), VALUES(last_dm_at))`,
    [zaloUid, displayName.slice(0, 255), sentAt],
  );
  await recomputeContactKinds(db, [zaloUid]);
  const contact = await findContactByUid(db, zaloUid);
  if (!contact) throw new Error(`Không ghi được danh bạ ${zaloUid}`);
  return contact;
}

/** Thành viên nhóm (đồng bộ thành viên): chỉ điền tên khi còn trống / có tên Zalo mới; ảnh lấy bản mới nhất. */
export async function upsertMemberContact(
  db: Executor,
  zaloUid: string,
  displayName: string,
  zaloName: string,
  avatarUrl = "",
  globalId = "",
): Promise<void> {
  await db.query(
    `INSERT INTO contact (zalo_uid, global_id, display_name, zalo_name, avatar_url) VALUES (?, NULLIF(?, ''), ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       global_id = COALESCE(VALUES(global_id), global_id),
       display_name = IF(display_name = '', VALUES(display_name), display_name),
       zalo_name = IF(VALUES(zalo_name) = '', zalo_name, VALUES(zalo_name)),
       avatar_url = IF(VALUES(avatar_url) = '', avatar_url, VALUES(avatar_url))`,
    [zaloUid, globalId.slice(0, 40), displayName.slice(0, 255), zaloName.slice(0, 255), avatarUrl.slice(0, 500)],
  );
}

/** Ghi hồ sơ Zalo lấy qua getUserInfo: ảnh đại diện, tên Zalo, globalId (mã chung giữa nhóm và nhắn riêng). */
export async function setContactZaloProfile(
  db: Db,
  zaloUid: string,
  profile: { avatar?: string; zaloName?: string; globalId?: string },
): Promise<void> {
  await db.query(
    `UPDATE contact SET
       avatar_url = IF(? = '', avatar_url, ?),
       zalo_name = IF(? = '', zalo_name, ?),
       global_id = COALESCE(NULLIF(?, ''), global_id)
     WHERE zalo_uid = ?`,
    [profile.avatar ?? "", (profile.avatar ?? "").slice(0, 500), profile.zaloName ?? "", (profile.zaloName ?? "").slice(0, 255),
     (profile.globalId ?? "").slice(0, 40), zaloUid],
  );
}

/** Người gửi tin trong nhóm: có rồi thì thôi — tránh một lượt ghi cho mỗi tin. */
export async function ensureSenderContact(db: Db, zaloUid: string, displayName: string): Promise<void> {
  await db.query("INSERT IGNORE INTO contact (zalo_uid, display_name) VALUES (?, ?)", [zaloUid, displayName.slice(0, 255)]);
}

export async function findContactByUid(db: Db, zaloUid: string): Promise<ContactRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, zalo_uid, display_name, zalo_name, kind, role, company_id FROM contact WHERE zalo_uid = ?",
    [zaloUid],
  );
  return (rows[0] as ContactRow | undefined) ?? null;
}

export interface ContactPatch {
  /** "auto" = trả về tự động theo nhóm; số = chỉnh tay. */
  kind: number | "auto";
  role: number;
  companyId: number | null;
  note: string;
}

export async function updateContact(db: Db, contactId: number, patch: ContactPatch): Promise<void> {
  await db.query("UPDATE contact SET role = ?, company_id = ?, note = ? WHERE id = ?", [
    patch.role,
    patch.companyId,
    patch.note.slice(0, 5000),
    contactId,
  ]);
  if (patch.kind === "auto") {
    await db.query("UPDATE contact SET kind_source = ? WHERE id = ?", [ContactKindSource.Auto, contactId]);
    const [rows] = await db.query<RowDataPacket[]>("SELECT zalo_uid FROM contact WHERE id = ?", [contactId]);
    if (rows[0]) await recomputeContactKinds(db, [rows[0].zalo_uid as string]);
    return;
  }
  // Chỉ đánh dấu "chỉnh tay" khi loại THẬT SỰ đổi — biểu mẫu gửi lại mọi ô kể cả khi chỉ đổi vai trò
  await db.query(
    `UPDATE contact SET kind_source = IF(kind <> ?, ?, kind_source), kind = ? WHERE id = ?`,
    [patch.kind, ContactKindSource.Manual, patch.kind, contactId],
  );
}

/**
 * Suy lại loại của những người (tự động) từ các nhóm họ đang ở: có nhóm nội bộ → Nhân sự; chỉ nhóm
 * khách hàng → Khách hàng; không nhóm nào nhưng đã nhắn riêng cho bot → Khách hàng (người lạ nhắn
 * tài khoản công ty phần lớn là khách); còn lại giữ nguyên. Người chỉnh tay không bị đụng.
 * uids rỗng = không làm gì (muốn chạy cho tất cả thì gọi với null).
 */
export async function recomputeContactKinds(db: Executor, uids: string[] | null): Promise<void> {
  if (uids && !uids.length) return;
  await db.query(
    `UPDATE contact c
     SET c.kind = CASE
       WHEN EXISTS (SELECT 1 FROM group_member gm JOIN zalo_group g ON g.id = gm.group_id
                    WHERE gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL AND g.thread_type = ? AND g.group_kind = ?) THEN ?
       WHEN EXISTS (SELECT 1 FROM group_member gm JOIN zalo_group g ON g.id = gm.group_id
                    WHERE gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL AND g.thread_type = ?) THEN ?
       -- Đã từng nhắn riêng bot (mốc ghi ngay lúc nhận tin, trước khi đếm số tin)
       WHEN c.last_dm_at IS NOT NULL THEN ?
       ELSE c.kind END
     WHERE c.kind_source = ? ${uids ? "AND c.zalo_uid IN (?)" : ""}`,
    [ConversationType.Group, GroupKind.Internal, ContactKind.Staff, ConversationType.Group, ContactKind.Customer,
     ContactKind.Customer, ContactKindSource.Auto, ...(uids ? [uids] : [])],
  );
}

/** Suy lại loại cho mọi thành viên (kể cả đã rời) của một nhóm — gọi sau khi đổi loại nhóm / đồng bộ thành viên. */
export async function recomputeGroupMemberKinds(db: Executor, groupId: number): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT zalo_uid FROM group_member WHERE group_id = ?", [groupId]);
  await recomputeContactKinds(db, rows.map((row) => row.zalo_uid as string));
}

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

/** Tách chuỗi "vip, đại lý; miền Nam" thành danh sách thẻ sạch, bỏ trùng (không phân biệt hoa thường). */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const piece of raw.split(/[,;\n]/)) {
    const tag = piece.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/** Thay toàn bộ thẻ của một người bằng danh sách mới. */
export async function setContactTags(db: Db, contactId: number, tags: string[]): Promise<void> {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM contact_tag WHERE contact_id = ?", [contactId]);
    if (tags.length) {
      await connection.query("INSERT INTO contact_tag (contact_id, tag) VALUES ?", [tags.map((tag) => [contactId, tag])]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getContactTags(db: Db, contactIds: number[]): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>();
  if (!contactIds.length) return result;
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT contact_id, tag FROM contact_tag WHERE contact_id IN (?) ORDER BY created_at, tag",
    [contactIds],
  );
  for (const row of rows) {
    const list = result.get(row.contact_id as number) ?? [];
    list.push(row.tag as string);
    result.set(row.contact_id as number, list);
  }
  return result;
}

/** Cộng một tin nhắn riêng — chỉ gọi khi tin thật sự mới được lưu. */
export async function countDirectMessage(db: Db, contactId: number): Promise<void> {
  await db.query("UPDATE contact SET dm_count = dm_count + 1 WHERE id = ?", [contactId]);
}
