import type { ReplyTemplateStatus, ReplyTone } from "../constants.js";

// Kiểu dùng chung của lõi «gợi ý trả lời» (phase 10 — N2): mẫu tin, tin gốc, bản nháp.

/** Một dòng bảng reply_template. `keywords` đã tách theo dấu phẩy. */
export interface ReplyTemplate {
  id: number;
  tenantId: number;
  name: string;
  situation: string;
  keywords: string[];
  body: string;
  tone: ReplyTone;
  status: ReplyTemplateStatus;
  authorUserId: number | null;
  authorName: string;
  reviewerUserId: number | null;
  reviewerName: string;
  reviewNote: string;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Trường người dùng nhập khi soạn / sửa mẫu (đã qua `validateTemplateInput`). */
export interface ReplyTemplateInput {
  name: string;
  situation: string;
  keywords: string[];
  body: string;
  tone: ReplyTone;
}

/** Tin gốc cần trả lời + vài tin ngay trước (cùng cuộc) — chữ đã che dữ liệu cá nhân nếu cài đặt bật. */
export interface ReplySource {
  messageId: number;
  groupName: string;
  senderName: string;
  sentAt: Date;
  text: string;
  /** Tối đa 5 tin trước đó trong cùng cuộc, cũ trước mới sau. */
  context: { senderName: string; sentAt: Date; text: string }[];
}

/** Bản nháp thô do mô hình viết (chưa kiểm). */
export interface RawDraft {
  tone: ReplyTone;
  text: string;
}

/** Bản nháp sau kiểm số / hứa hẹn / kỹ thuật. */
export interface GuardedDraft extends RawDraft {
  /** Số chỗ bị thay «[cần bổ sung]» (gồm cả chỗ trống mẫu mô hình chưa điền). */
  replaced: number;
  /** Số chỗ bị thay «[cần kỹ thuật xác nhận]». */
  technical: number;
  /** Cụm hứa hẹn mẫu không có («chiết khấu», «hoàn tiền»…). */
  warnings: string[];
}

/** Kết quả hoàn chỉnh của một lượt gợi ý — đầu vào của `formatSuggestion`. */
export interface SuggestionResult {
  templateId: number;
  templateName: string;
  source: ReplySource | null;
  drafts: GuardedDraft[];
  /** Câu hỏi / tin gốc thuộc chủ đề kỹ thuật BVTV. */
  agro: boolean;
}

/** Phần ĐỌC dữ liệu của «gợi ý trả lời»: số lượt trong giờ, tin gốc + ngữ cảnh, mẫu đã duyệt. Đường hệ thống dùng bản SQL (`reply-suggestion-sql-reader.ts`),
 *  trợ lý dùng bản đi qua công cụ MCP `reply_sources`. Phần sinh AI không nằm ở đây (tác động ngoài). */
export interface ReplySourceReader {
  /** Số lần `suggest_replies` của liên hệ trong 1 giờ trước `now`. */
  hourlyCount(contactId: number, now: Date): Promise<number>;
  loadSource(messageId: number, options: ReplySourceOptions): Promise<{ source: ReplySource } | { error: string }>;
  listApprovedTemplates(tenantId: number): Promise<ReplyTemplate[]>;
}

export interface ReplySourceOptions {
  /** Hỏi trong nhóm: chỉ nhận tin của chính nhóm đó. */
  scopeGroupId?: number;
  /** Mã Zalo người hỏi — tin trong cuộc nhắn riêng chỉ nhận khi đó là cuộc của chính họ. */
  askerUid?: string;
  maskPersonal: boolean;
  includeConfidential?: boolean;
}
