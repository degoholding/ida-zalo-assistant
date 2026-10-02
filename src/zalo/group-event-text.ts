import { createHash } from "node:crypto";
import { GroupEventType, type GroupEvent } from "zca-js";

// Sự kiện nhóm (vào / rời / thêm người / đổi tên…) → một dòng «tin hệ thống» trong khung chat, như Zalo
// vẽ ở giữa màn hình. Trước 02/10/2026 bot chỉ dùng sự kiện để đồng bộ thành viên rồi bỏ đi, nên khung
// chat thủng những mốc «ai vào nhóm lúc nào».

/** Sự kiện đủ thông tin để thành câu; sự kiện còn lại (ghim, nhắc hẹn, cài đặt…) bỏ qua. */
export interface GroupEventSummary {
  /** Mã tin tự dựng — nhiều bot cùng nhóm nhận cùng một sự kiện ra cùng một mã, khóa duy nhất lo trùng. */
  msgId: string;
  text: string;
  actorUid: string;
  sentAtMs: number;
}

interface MemberLike {
  id: string;
  dName?: string;
}

/** Tên một người: tên Zalo gửi kèm sự kiện trước, rồi tên trong kho, cuối cùng «Một thành viên». */
export type NameLookup = (uid: string) => string;

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} và ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(", ")} và ${names.length - 2} người khác`;
}

function eventMembers(event: GroupEvent): MemberLike[] {
  const data = event.data as { updateMembers?: (MemberLike | string)[] };
  return (data.updateMembers ?? []).map((member) => (typeof member === "string" ? { id: member } : member));
}

function eventTimeMs(event: GroupEvent, nowMs: number): number {
  const data = event.data as { time?: string | number };
  const value = Number(data.time);
  return Number.isFinite(value) && value > 0 ? value : nowMs;
}

/**
 * Dịch một sự kiện nhóm thành câu. `previousGroupName` để nhận ra sự kiện UPDATE là đổi tên (Zalo gộp
 * nhiều kiểu cập nhật vào một loại). Trả null khi sự kiện không đáng ghi.
 */
export function describeGroupEvent(event: GroupEvent, lookupName: NameLookup, previousGroupName: string, nowMs = Date.now()): GroupEventSummary | null {
  const data = event.data as { sourceId?: string; creatorId?: string; groupName?: string };
  const actorUid = String(data.sourceId || data.creatorId || "");
  const members = eventMembers(event);
  const nameOf = (member: MemberLike) => (member.dName || "").trim() || lookupName(member.id);
  const actor = actorUid ? lookupName(actorUid) : "Một thành viên";
  const memberNames = joinNames(members.map(nameOf));
  const selfOnly = members.length === 1 && members[0].id === actorUid;

  let text = "";
  switch (event.type) {
    case GroupEventType.JOIN:
      if (!members.length) return null;
      text = !actorUid || selfOnly ? `${memberNames} đã tham gia nhóm` : `${actor} đã thêm ${memberNames} vào nhóm`;
      break;
    case GroupEventType.LEAVE:
      if (!members.length) return null;
      text = `${memberNames} đã rời khỏi nhóm`;
      break;
    case GroupEventType.REMOVE_MEMBER:
      if (!members.length) return null;
      text = `${actor} đã xóa ${memberNames} khỏi nhóm`;
      break;
    case GroupEventType.BLOCK_MEMBER:
      if (!members.length) return null;
      text = `${actor} đã chặn ${memberNames} khỏi nhóm`;
      break;
    case GroupEventType.ADD_ADMIN:
      if (!members.length) return null;
      text = `${actor} đã bổ nhiệm ${memberNames} làm phó nhóm`;
      break;
    case GroupEventType.REMOVE_ADMIN:
      if (!members.length) return null;
      text = `${actor} đã gỡ quyền phó nhóm của ${memberNames}`;
      break;
    case GroupEventType.UPDATE_AVATAR:
      text = `${actor} đã đổi ảnh đại diện nhóm`;
      break;
    case GroupEventType.NEW_LINK:
      text = `${actor} đã tạo link mời vào nhóm mới`;
      break;
    case GroupEventType.UPDATE: {
      const newName = String(data.groupName ?? "").trim();
      // Chỉ ghi khi đúng là đổi tên — các cập nhật khác (cài đặt, mô tả) Zalo cũng bắn UPDATE
      if (!newName || newName === previousGroupName.trim()) return null;
      text = `${actor} đã đổi tên nhóm thành «${newName}»`;
      break;
    }
    default:
      return null;
  }

  const sentAtMs = eventTimeMs(event, nowMs);
  const fingerprint = [event.type, event.threadId, actorUid, sentAtMs, members.map((member) => member.id).sort().join(",")].join("|");
  return { msgId: `sys${createHash("sha1").update(fingerprint).digest("hex").slice(0, 24)}`, text, actorUid, sentAtMs };
}

/** Các uid cần tra tên trong kho cho một sự kiện (người làm + người bị tác động thiếu tên kèm theo). */
export function namesToLookup(event: GroupEvent): string[] {
  const data = event.data as { sourceId?: string; creatorId?: string };
  const uids = new Set<string>();
  const actor = String(data.sourceId || data.creatorId || "");
  if (actor) uids.add(actor);
  for (const member of eventMembers(event)) if (!member.dName) uids.add(member.id);
  return [...uids];
}
