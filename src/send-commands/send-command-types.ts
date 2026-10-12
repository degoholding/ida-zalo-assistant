import type { ContactRole, SendActionKind, SendCommandSource, SendCommandStatus, SendTargetKind, SendTargetStatus } from "../constants.js";

// Kiểu dùng chung của dịch vụ lệnh gửi (phase 9). Chỉ khai kiểu — hàm nằm ở các tệp send-command-*.ts khác.

/** Người ra lệnh — cùng hình `AlertAsker` (assistant/alert-tools.ts). */
export interface SendRequester {
  uid: string;
  name: string;
  role: ContactRole;
  /** id người nhận nếu họ là người nhận đang bật */
  recipientId: number | null;
}

/** Một nơi nhận đã phân giải, chưa ghi DB. */
export interface ResolvedTarget {
  kind: SendTargetKind;
  /** «g:<threadId>» | «u:<zaloUid>» */
  key: string;
  threadId: number | null;
  zaloUid: string | null;
  displayName: string;
}

/** Mã lặp của nhắc hẹn Zalo: 0 không · 1 ngày · 2 tuần · 3 tháng. */
export type ReminderRepeat = 0 | 1 | 2 | 3;

export interface DraftInput {
  source: SendCommandSource;
  tenantId?: number;
  requesterContactId?: number | null;
  requesterUid?: string;
  requesterName?: string;
  createdByUserId?: number | null;
  botAccountId?: number | null;
  sourceThreadId?: number | null;
  sourceMessageId?: number | null;
  body: string;
  attachmentIds?: number[];
  scheduledAt?: Date | null;
  offHoursNote?: string;
  /** NULL cho dòng nhật ký web (không qua bước xác nhận) */
  confirmExpiresAt?: Date | null;
  /** Mặc định Draft; dòng web ghi thẳng Done / Sending */
  status?: SendCommandStatus;
  /** Mặc định Message. Reminder: `body` = tiêu đề nhắc, `reminderAt` bắt buộc */
  actionKind?: SendActionKind;
  reminderAt?: Date | null;
  /** 0 không lặp · 1 hằng ngày · 2 hằng tuần · 3 hằng tháng (mã của Zalo) */
  reminderRepeat?: ReminderRepeat;
  targets: ResolvedTarget[];
}

export interface SendCommandRow {
  id: number;
  tenantId: number;
  source: SendCommandSource;
  status: SendCommandStatus;
  requesterContactId: number | null;
  requesterUid: string;
  requesterName: string;
  createdByUserId: number | null;
  botAccountId: number | null;
  sourceThreadId: number | null;
  sourceMessageId: number | null;
  body: string;
  attachmentIds: number[];
  scheduledAt: Date | null;
  actionKind: SendActionKind;
  reminderAt: Date | null;
  reminderRepeat: ReminderRepeat;
  offHoursNote: string;
  confirmExpiresAt: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancelledBy: string;
  reportedAt: Date | null;
  createdAt: Date;
}

export interface SendTargetRow {
  id: number;
  commandId: number;
  kind: SendTargetKind;
  key: string;
  threadId: number | null;
  zaloUid: string | null;
  displayName: string;
  status: SendTargetStatus;
  attemptNo: number;
  jobId: number | null;
  error: string;
  sentAt: Date | null;
}
