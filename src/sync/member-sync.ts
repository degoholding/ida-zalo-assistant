import type { RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";
import { liveEvents } from "../live-events.js";
import { recomputeGroupMemberKinds, upsertMemberContact } from "./contact-repository.js";

// Chỉ những hàm zca-js mà đồng bộ thành viên cần — khai hẹp để bài kiểm thay bằng bản giả được.
export interface GroupInfoSource {
  getGroupInfo(groupId: string): Promise<{
    gridInfoMap: Record<string, {
      name: string;
      totalMember: number;
      avt?: string;
      fullAvt?: string;
      memberIds?: string[];
      memVerList?: string[];
      adminIds?: string[];
      creatorId?: string;
      currentMems?: { id: string; dName: string; zaloName: string; avatar?: string }[];
    }>;
  }>;
  getGroupMembersInfo(memberIds: string[]): Promise<{
    profiles: Record<string, { displayName: string; zaloName: string; avatar?: string }>;
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
  const names = new Map<string, { displayName: string; zaloName: string; avatar: string; globalId: string }>();
  for (const member of info.currentMems ?? []) {
    names.set(member.id, { displayName: member.dName ?? "", zaloName: member.zaloName ?? "", avatar: member.avatar ?? "", globalId: "" });
  }
  // Hỏi hồ sơ cho MỌI thành viên: currentMems chỉ có một phần với nhóm đông.
  // ⚠️ KHÔNG lấy globalId ở đây: getGroupMembersInfo trả CÙNG một globalId cho mọi thành viên (đo thật
  // 01/10/2026) — globalId đúng phải hỏi bằng getUserInfo, nơi gọi lo việc đó.
  for (let start = 0; start < ids.length; start += PROFILE_BATCH_SIZE) {
    const batch = ids.slice(start, start + PROFILE_BATCH_SIZE);
    const profiles = await source.getGroupMembersInfo(batch).catch(() => ({ profiles: {} }));
    for (const [rawId, profile] of Object.entries(profiles.profiles ?? {})) {
      const id = rawId.split("_")[0];
      const known = names.get(id);
      names.set(id, {
        displayName: known?.displayName || profile.displayName || "",
        zaloName: profile.zaloName || known?.zaloName || "",
        avatar: profile.avatar || known?.avatar || "",
        globalId: "",
      });
    }
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [beforeRows] = await connection.query<RowDataPacket[]>("SELECT name, member_count FROM zalo_group WHERE id = ? FOR UPDATE", [groupId]);
    const newName = String(info.name ?? "").slice(0, 255);
    const newCount = info.totalMember ?? ids.length;
    await connection.query(
      `UPDATE zalo_group SET name = ?, member_count = ?, members_synced_at = CURRENT_TIMESTAMP(3),
         avatar_url = IF(? = '', avatar_url, ?) WHERE id = ?`,
      [newName, newCount,
       (info.fullAvt || info.avt || "").slice(0, 500), (info.fullAvt || info.avt || "").slice(0, 500), groupId],
    );
    for (const id of ids) {
      const profile = names.get(id) ?? { displayName: "", zaloName: "", avatar: "", globalId: "" };
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
      await upsertMemberContact(connection, id, profile.displayName, profile.zaloName, profile.avatar, profile.globalId);
    }
    const [knownRows] = await connection.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM group_member WHERE group_id = ? AND left_at IS NULL", [groupId]);
    const knownBefore = Number(knownRows[0].n);
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
    // Tên / số thành viên / người vào-ra đổi thật thì báo giao diện (SSE). Tin hệ thống «đổi tên nhóm» được
    // đẩy TRƯỚC khi bước này ghi tên mới — thiếu sự kiện này thì cột trái giữ tên cũ (gặp 06/10/2026).
    const before = beforeRows[0];
    const changed = !before || before.name !== newName || Number(before.member_count) !== newCount || left > 0 || knownBefore !== ids.length;
    if (changed) liveEvents.emitMessage({ threadId: groupId, messageId: 0, kind: "thread_updated" });
    return { found: true, members: ids.length, left };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
