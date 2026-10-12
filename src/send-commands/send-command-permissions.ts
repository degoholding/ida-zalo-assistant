import { ContactKind, ContactRole, ConversationType, FriendRequestStatus, GroupKind } from "../constants.js";
import type { SendRequester } from "./send-command-types.js";

// Luật quyền của lệnh gửi (phase 9) — hàm THUẦN, service gọi lại ở mọi bước (nháp, xác nhận, giao), không dựa vào prompt.

/** Người nhận đang bật HOẶC có vai trò Quản lý / Trưởng phòng — một trong hai là đủ (chốt 12/10/2026). */
export function canIssueSendCommand(asker: SendRequester): boolean {
  return asker.role !== ContactRole.None || asker.recipientId !== null;
}

/** Tắt bot khẩn: ai ra lệnh gửi được thì tắt được. */
export function canHaltBot(asker: SendRequester): boolean {
  return canIssueSendCommand(asker);
}

/** Bật lại bot bằng câu Zalo: chỉ người nhận đang bật (vai trò thôi thì chưa đủ). */
export function canResumeBot(asker: SendRequester): boolean {
  return asker.recipientId !== null;
}

/** Phạm vi nhóm của người ra lệnh: chỉ nhóm họ CHỌN (`recipient_group`); «mọi nhóm» KHÔNG tính cho nhóm Mật. */
export interface SendGroupScope {
  selectedGroupIds: number[];
}

export interface SendGroupCandidate {
  id: number;
  /** zalo_group.thread_type */
  threadType: ConversationType;
  groupKind: GroupKind;
  isConfidential: boolean;
  /** Bot còn trong nhóm (bot_group.left_at IS NULL) */
  botStillInGroup: boolean;
  /** zalo_group.zalo_group_id — mã giả `demo-` / `web-` không gửi ra Zalo được */
  zaloGroupId: string;
}

/** Mã giả của dữ liệu mẫu / cuộc hỏi trợ lý trên web — không có thật bên Zalo. */
export function isFakeZaloId(zaloId: string): boolean {
  return zaloId.startsWith("demo-") || zaloId.startsWith("web-");
}

/** Nhóm nội bộ mà bot còn ở; nhóm Mật chỉ khi người ra lệnh đã chọn đúng nhóm đó. */
export function isAllowedGroupTarget(group: SendGroupCandidate, scope: SendGroupScope): boolean {
  if (group.threadType !== ConversationType.Group) return false;
  if (group.groupKind !== GroupKind.Internal) return false;
  if (!group.botStillInGroup) return false;
  if (isFakeZaloId(group.zaloGroupId)) return false;
  if (group.isConfidential && !scope.selectedGroupIds.includes(group.id)) return false;
  return true;
}

export interface SendPersonCandidate {
  kind: ContactKind;
  zaloUid: string;
  /** Mã Zalo của chính các tài khoản bot */
  isBotAccount: boolean;
  hasDirectThread: boolean;
  /** friend_request mới nhất giữa bot và người này */
  friendStatus: FriendRequestStatus | null;
}

/** Người nội bộ (loại Nhân sự), không phải bot, đã có cuộc riêng hoặc là bạn Zalo của bot. */
export function isAllowedPersonTarget(contact: SendPersonCandidate): boolean {
  if (contact.kind !== ContactKind.Staff) return false;
  if (contact.isBotAccount || isFakeZaloId(contact.zaloUid)) return false;
  return contact.hasDirectThread || contact.friendStatus === FriendRequestStatus.Accepted;
}
