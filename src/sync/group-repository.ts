import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { ConversationType, GroupKind } from "../constants.js";
import type { Db } from "../db/pool.js";
import { recomputeGroupMemberKinds } from "./contact-repository.js";

// Bảng zalo_group chứa cả nhóm lẫn cuộc trò chuyện riêng 1-1 (thread_type) — xem migration 002.
export interface GroupRow {
  id: number;
  thread_type: number;
  group_kind: number;
  zalo_group_id: string;
  owner_bot_id: number;
  company_id: number | null;
  name: string;
  label: string;
  read_messages: number;
  capture_files: number;
  retention_days: number;
}

export interface GroupDefaults {
  readMessages: boolean;
  captureFiles: boolean;
}

export const GROUP_COLUMNS = "id, thread_type, group_kind, zalo_group_id, owner_bot_id, company_id, name, label, read_messages, capture_files, retention_days";

/** Khóa xác định một cuộc trò chuyện: nhóm (owner_bot_id = 0) hoặc riêng (bot nhận tin). */
export interface ThreadKey {
  threadType: ConversationType;
  zaloThreadId: string;
  ownerBotId: number;
}

export function groupKey(zaloGroupId: string): ThreadKey {
  return { threadType: ConversationType.Group, zaloThreadId: zaloGroupId, ownerBotId: 0 };
}

export function directKey(botAccountId: number, peerUid: string): ThreadKey {
  return { threadType: ConversationType.Direct, zaloThreadId: peerUid, ownerBotId: botAccountId };
}

export async function findThread(db: Db, key: ThreadKey): Promise<GroupRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${GROUP_COLUMNS} FROM zalo_group WHERE thread_type = ? AND zalo_group_id = ? AND owner_bot_id = ?`,
    [key.threadType, key.zaloThreadId, key.ownerBotId],
  );
  return (rows[0] as GroupRow | undefined) ?? null;
}

export async function findGroupByZaloId(db: Db, zaloGroupId: string): Promise<GroupRow | null> {
  return findThread(db, groupKey(zaloGroupId));
}

/**
 * Có rồi thì trả về, chưa có thì tạo với cấu hình mặc định. `created` = true nghĩa là hệ thống vừa
 * thấy nhóm này lần đầu — nơi gọi dùng nó để ghi bot vào nhóm, đồng bộ thành viên, báo quản lý.
 */
export async function ensureGroup(
  db: Db,
  zaloGroupId: string,
  defaults: GroupDefaults,
): Promise<{ group: GroupRow; created: boolean }> {
  return ensureThread(db, groupKey(zaloGroupId), defaults);
}

/** Có rồi thì trả về, chưa có thì tạo — dùng chung cho nhóm và cuộc trò chuyện riêng. */
export async function ensureThread(
  db: Db,
  key: ThreadKey,
  defaults: GroupDefaults,
  name = "",
): Promise<{ group: GroupRow; created: boolean }> {
  const existing = await findThread(db, key);
  if (existing) return { group: existing, created: false };
  const [result] = await db.query<ResultSetHeader>(
    `INSERT IGNORE INTO zalo_group (thread_type, zalo_group_id, owner_bot_id, name, member_count, read_messages, capture_files)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [key.threadType, key.zaloThreadId, key.ownerBotId, name.slice(0, 255),
     key.threadType === ConversationType.Direct ? 2 : 0, defaults.readMessages ? 1 : 0, defaults.captureFiles ? 1 : 0],
  );
  const group = await findThread(db, key);
  if (!group) throw new Error(`Không tạo được cuộc trò chuyện ${key.zaloThreadId}`);
  // Hai tin cùng tới một lúc: chỉ lượt thật sự chèn được mới tính là "vừa tạo"
  return { group, created: result.affectedRows === 1 };
}

/** Ghi nhận bot đang ở nhóm (vào mới, hoặc quay lại sau khi rời). */
export async function markBotInGroup(db: Db, botAccountId: number, groupId: number): Promise<void> {
  await db.query(
    `INSERT INTO bot_group (bot_account_id, group_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE left_at = NULL`,
    [botAccountId, groupId],
  );
}

/** Bot rời / bị mời ra một nhóm. Các bot khác trong nhóm không bị ảnh hưởng. */
export async function markBotLeftGroup(db: Db, botAccountId: number, zaloGroupId: string): Promise<void> {
  await db.query(
    `UPDATE bot_group bg JOIN zalo_group g ON g.id = bg.group_id
     SET bg.left_at = CURRENT_TIMESTAMP(3)
     WHERE bg.bot_account_id = ? AND g.thread_type = ? AND g.zalo_group_id = ? AND bg.left_at IS NULL`,
    [botAccountId, ConversationType.Group, zaloGroupId],
  );
}

/**
 * Đối chiếu với danh sách nhóm Zalo trả về lúc khởi động: nhóm bot từng ở mà nay không còn trong
 * danh sách (bị mời ra lúc dịch vụ đang tắt) thì đánh dấu rời. Danh sách rỗng thì không làm gì —
 * có thể Zalo trả lỗi im lặng, đừng đánh dấu rời hàng loạt.
 */
export async function markBotLeftMissingGroups(db: Db, botAccountId: number, currentGroupIds: number[]): Promise<number> {
  if (!currentGroupIds.length) return 0;
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE bot_group SET left_at = CURRENT_TIMESTAMP(3)
     WHERE bot_account_id = ? AND left_at IS NULL AND group_id NOT IN (?)`,
    [botAccountId, currentGroupIds],
  );
  return result.affectedRows;
}

export interface GroupSettingsPatch {
  readMessages?: boolean;
  captureFiles?: boolean;
  label?: string;
  retentionDays?: number;
  /** null = gỡ khỏi công ty */
  companyId?: number | null;
  groupKind?: number;
}

/**
 * Chốt 07/10/2026: nhóm đánh dấu NỘI BỘ thì tự bật đọc tin — trừ khi cùng lượt sửa nói rõ tắt đọc. Hàm thuần, dùng
 * chung cho API web và dòng lệnh để hai đường cho cùng một kết quả.
 */
export function applyInternalGroupDefaults(patch: GroupSettingsPatch): GroupSettingsPatch {
  if (patch.groupKind === GroupKind.Internal && patch.readMessages === undefined) return { ...patch, readMessages: true };
  return patch;
}

export async function updateGroupSettings(db: Db, groupId: number, input: GroupSettingsPatch): Promise<void> {
  const patch = applyInternalGroupDefaults(input);
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.readMessages !== undefined) {
    sets.push("read_messages = ?");
    values.push(patch.readMessages ? 1 : 0);
  }
  if (patch.captureFiles !== undefined) {
    sets.push("capture_files = ?");
    values.push(patch.captureFiles ? 1 : 0);
  }
  if (patch.label !== undefined) {
    sets.push("label = ?");
    values.push(patch.label.slice(0, 100));
  }
  if (patch.retentionDays !== undefined) {
    sets.push("retention_days = ?");
    values.push(patch.retentionDays);
  }
  if (patch.companyId !== undefined) {
    sets.push("company_id = ?");
    values.push(patch.companyId);
  }
  if (patch.groupKind !== undefined) {
    sets.push("group_kind = ?");
    values.push(patch.groupKind);
  }
  if (!sets.length) return;
  const [result] = await db.query<ResultSetHeader>(`UPDATE zalo_group SET ${sets.join(", ")} WHERE id = ?`, [...values, groupId]);
  // Đổi loại nhóm thì loại mặc định của thành viên đổi theo
  if (patch.groupKind !== undefined && result.changedRows) await recomputeGroupMemberKinds(db, groupId);
}
