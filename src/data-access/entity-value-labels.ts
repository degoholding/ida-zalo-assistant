import {
  AttachmentStatus, CatalogKind, CatalogMatchStatus, ContactKind, ContactRole, ConversationType, GroupKind, MessageKind,
  MetricFlag, ReplyTemplateStatus, ReplyTone, SendActionKind, SendCommandSource, SendCommandStatus, TaskPriority, TaskSource,
  TaskStatus, TicketStatus,
} from "../constants.js";

// Nhãn tiếng Việt cho mã số (SMALLINT) của từng trường — `describe_entities` đưa cho mô hình biết «kind = 1 là Khách».
// Mã số lấy từ `src/constants.ts` (một nguồn); chỉ phần nhãn viết ở đây.

type Labels = Record<number, string>;

const kind: Labels = { [ContactKind.Unclassified]: "Chưa phân loại", [ContactKind.Customer]: "Khách", [ContactKind.Staff]: "Nhân sự" };

/** Khóa «<thực thể>.<trường>». */
export const VALUE_LABELS: Record<string, Labels> = {
  "groups.group_kind": { [GroupKind.Customer]: "Nhóm khách", [GroupKind.Internal]: "Nhóm nội bộ" },
  "messages.kind": {
    [MessageKind.Text]: "Chữ", [MessageKind.Image]: "Ảnh", [MessageKind.File]: "Tệp", [MessageKind.Video]: "Video", [MessageKind.Voice]: "Ghi âm",
    [MessageKind.Sticker]: "Nhãn dán", [MessageKind.Link]: "Liên kết", [MessageKind.Location]: "Vị trí", [MessageKind.Contact]: "Danh thiếp",
    [MessageKind.System]: "Sự kiện nhóm", [MessageKind.Other]: "Khác",
  },
  "messages.thread_type": { [ConversationType.Direct]: "Nhắn riêng", [ConversationType.Group]: "Nhóm" },
  "contacts.kind": kind,
  "contacts.role": { [ContactRole.None]: "Không", [ContactRole.DepartmentHead]: "Trưởng phòng", [ContactRole.Manager]: "Quản lý" },
  "contacts.catalog_kind": { [CatalogKind.Staff]: "Nhân viên", [CatalogKind.Dealer]: "Đại lý" },
  "files.status": {
    [AttachmentStatus.Pending]: "Chờ tải", [AttachmentStatus.Stored]: "Đã lưu", [AttachmentStatus.Failed]: "Lỗi", [AttachmentStatus.Skipped]: "Bỏ qua",
    [AttachmentStatus.Expired]: "Hết hạn giữ tệp",
  },
  "files.thread_type": { [ConversationType.Direct]: "Nhắn riêng", [ConversationType.Group]: "Nhóm" },
  "tasks.status": { [TaskStatus.Proposed]: "Đề xuất", [TaskStatus.Open]: "Đang làm", [TaskStatus.Done]: "Xong", [TaskStatus.Cancelled]: "Hủy" },
  "tasks.priority": { [TaskPriority.High]: "Cao", [TaskPriority.Normal]: "Vừa", [TaskPriority.Low]: "Thấp" },
  "tasks.source": {
    [TaskSource.Command]: "Lệnh giao", [TaskSource.Assistant]: "Trợ lý", [TaskSource.Recap]: "Recap họp", [TaskSource.AiReview]: "AI bắt từ tin", [TaskSource.Web]: "Web",
  },
  "tickets.status": { [TicketStatus.New]: "Mới", [TicketStatus.InProgress]: "Đang xử lý", [TicketStatus.Done]: "Xong", [TicketStatus.Cancelled]: "Hủy" },
  "send_commands.status": {
    [SendCommandStatus.Draft]: "Nháp", [SendCommandStatus.Scheduled]: "Đã hẹn", [SendCommandStatus.Sending]: "Đang gửi", [SendCommandStatus.Done]: "Xong",
    [SendCommandStatus.Cancelled]: "Hủy", [SendCommandStatus.Expired]: "Nháp hết hạn",
  },
  "send_commands.source": { [SendCommandSource.Zalo]: "Zalo", [SendCommandSource.Web]: "Web" },
  "send_commands.action_kind": { [SendActionKind.Message]: "Gửi tin", [SendActionKind.Reminder]: "Nhắc hẹn", [SendActionKind.Pin]: "Ghim" },
  "reply_templates.status": {
    [ReplyTemplateStatus.Draft]: "Nháp", [ReplyTemplateStatus.PendingReview]: "Chờ duyệt", [ReplyTemplateStatus.Approved]: "Đã duyệt",
    [ReplyTemplateStatus.Returned]: "Trả lại", [ReplyTemplateStatus.Archived]: "Ngừng dùng",
  },
  "reply_templates.tone": { [ReplyTone.Formal]: "Trang trọng", [ReplyTone.Friendly]: "Thân thiện", [ReplyTone.Brief]: "Ngắn gọn" },
  "metrics.flags": {
    0: "Sạch cờ", [MetricFlag.Negative]: "Số âm", [MetricFlag.Deviation]: "Lệch > 30%", [MetricFlag.Unparsed]: "Ô không đọc được", [MetricFlag.UnknownStaff]: "Nhân viên lạ",
  },
  "catalog.kind": { [CatalogKind.Staff]: "Nhân viên", [CatalogKind.Dealer]: "Đại lý" },
  "catalog.match_status": {
    [CatalogMatchStatus.Unmatched]: "Chưa khớp", [CatalogMatchStatus.Matched]: "Khớp theo SĐT", [CatalogMatchStatus.Suggested]: "Gợi ý (chờ xác nhận)",
    [CatalogMatchStatus.Confirmed]: "Đã xác nhận", [CatalogMatchStatus.Unlinked]: "Đã bỏ gắn",
  },
};

export function labelsFor(entity: string, field: string): Labels | undefined {
  return VALUE_LABELS[`${entity}.${field}`];
}
