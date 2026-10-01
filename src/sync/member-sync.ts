import type { Db } from "../db/pool.js";
import { recomputeGroupMemberKinds, upsertMemberContact } from "./contact-repository.js";

// Chỉ những hàm zca-js mà đồng bộ thành viên cần — khai hẹp để bài kiểm thay bằng bản giả được.
export interface GroupInfoSource {
  getGroupInfo(groupId: string): Promise<{
    gridInfoMap: Record<string, {
      name: string;
      totalMember: number;
      memberIds?: string[];
      memVerList?: string[];
      adminIds?: string[];
      creatorId?: string;
      currentMems?: { id: string; dName: string; zaloName: string }[];
    }>;
  }>;
  getGroupMembersInfo(memberIds: string[]): Promise<{
    profiles: Record<string, { displayName: string; zaloName: string }>;
  }>;
}

const PROFILE_BATCH_SIZE = 50;

// memVerList có dạng "uid_version" — bỏ đuôi version
function memberIdsOf(info: { memberIds?: string[]; memVerList?: string[] }): string[] {
  if (info.memVerList?.length) return info.memVerList.map((item) => item.split("_")[0]).filter(Boolean);
  return info.memberIds ?? [];
}

export interface MemberSyncResult {
  found: boolean;
  members: number;
  left: number;
}

/**
 * Đồng bộ tên nhóm + danh sách thành viên. Ai không còn trong danh sách thì đánh dấu left_at
 * (không xóa: tin cũ của họ vẫn cần tên). Ai quay lại thì gỡ left_at.
 */
export async function syncGroupMembers(
  db: Db,
  source: GroupInfoSource,
  groupId: number,
  zaloGroupId: string,
): Promise<MemberSyncResult> {
  const response = await source.getGroupInfo(zaloGroupId);
  const info = response.gridInfoMap?.[zaloGroupId];
  if (!info) return { found: false, members: 0, left: 0 };

  const ids = memberIdsOf(info);
  const admins = new Set([...(info.adminIds ?? []), info.creatorId ?? ""].filter(Boolean));
  const names = new Map<string, { displayName: string; zaloName: string }>();
  for (const member of info.currentMems ?? []) {
    names.set(member.id, { displayName: member.dName ?? "", zaloName: member.zaloName ?? "" });
  }
  // currentMems chỉ có một phần với nhóm đông — hỏi thêm hồ sơ cho phần còn thiếu
  const missing = ids.filter((id) => !names.has(id));
  for (let start = 0; start < missing.length; start += PROFILE_BATCH_SIZE) {
    const batch = missing.slice(start, start + PROFILE_BATCH_SIZE);
    const profiles = await source.getGroupMembersInfo(batch).catch(() => ({ profiles: {} }));
    for (const [rawId, profile] of Object.entries(profiles.profiles ?? {})) {
      names.set(rawId.split("_")[0], { displayName: profile.displayName ?? "", zaloName: profile.zaloName ?? "" });
    }
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "UPDATE zalo_group SET name = ?, member_count = ?, members_synced_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [String(info.name ?? "").slice(0, 255), info.totalMember ?? ids.length, groupId],
    );
    for (const id of ids) {
      const profile = names.get(id) ?? { displayName: "", zaloName: "" };
      await connection.query(
        `INSERT INTO group_member (group_id, zalo_uid, display_name, zalo_name, is_admin)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           display_name = IF(VALUES(display_name) = '', display_name, VALUES(display_name)),
           zalo_name = IF(VALUES(zalo_name) = '', zalo_name, VALUES(zalo_name)),
           is_admin = VALUES(is_admin),
           left_at = NULL`,
        [groupId, id, profile.displayName.slice(0, 255), profile.zaloName.slice(0, 255), admins.has(id) ? 1 : 0],
      );
      // Thành viên nhóm vào Danh bạ luôn — để hỏi «chị A» ra đúng người dù mỗi nhóm một tên
      await upsertMemberContact(connection, id, profile.displayName, profile.zaloName);
    }
    let left = 0;
    if (ids.length) {
      const [result] = await connection.query(
        `UPDATE group_member SET left_at = CURRENT_TIMESTAMP(3)
         WHERE group_id = ? AND left_at IS NULL AND zalo_uid NOT IN (?)`,
        [groupId, ids],
      );
      left = (result as { affectedRows: number }).affectedRows;
    }
    // Vào/rời nhóm làm đổi loại mặc định (khách hàng / nhân sự) của người đó
    await recomputeGroupMemberKinds(connection, groupId);
    await connection.commit();
    return { found: true, members: ids.length, left };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
