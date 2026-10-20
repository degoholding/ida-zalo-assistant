// Dựng CÂU TRẢ LỜI tiếng Việt từ KẾT QUẢ CÓ CẤU TRÚC của công cụ ticket (lõi `data-access/tickets/`). Câu trả lời là hợp đồng với người dùng
// nên chép NGUYÊN chuỗi của đường cũ (ticket-commands-legacy.ts); test vàng so từng ký tự cũ / mới. Hàm thuần — không đụng DB.

export interface TicketListingResult {
  /** open = người xử lý / quản lý thấy ticket đang mở; mine = ticket mình đã báo. */
  mode: "open" | "mine";
  lines: string[];
}

export interface TicketCreatedResult {
  outcome: "created";
  ticket_id: number;
  code: string;
  attachment_count: number;
  handler_count: number;
}

export type TicketActOutcome =
  | { outcome: "accepted"; ticket_id: number; code: string; requester_name: string }
  | { outcome: "closed_by_handler"; ticket_id: number; code: string; requester_name: string }
  | { outcome: "closed_by_requester"; ticket_id: number; code: string }
  | { outcome: "cancelled"; ticket_id: number; code: string }
  | { outcome: "note_sent"; ticket_id: number; code: string; requester_name: string }
  | { outcome: "note_added"; ticket_id: number; code: string; attachment_count: number; reopened: boolean };

/** Lỗi nghiệp vụ của lõi (đã đổi từ `_meta` lỗi của công cụ): `not_allowed` kèm `reason`, `invalid_state` kèm câu của ticket-service. */
export interface TicketToolFailure {
  code: string;
  message: string;
  reason?: string;
}

const NOT_FOUND = (id: number) => `Em không thấy ticket T-${id} của anh/chị. Nhắn «ticket» để xem danh sách.`;
const NOT_ALLOWED_BY_REASON: Record<string, string | undefined> = {
  handler_only: "Chỉ người xử lý ticket mới nhận được. Quản trị thêm người xử lý ở màn Ticket.",
  handler_or_requester: "Chỉ người xử lý ticket (hoặc chính người báo) mới báo xong được.",
};

export function listingReply(result: TicketListingResult): string {
  if (result.mode === "open") {
    if (!result.lines.length) return "Hiện không có ticket nào đang mở.";
    return [`TICKET ĐANG MỞ (${result.lines.length})`, ...result.lines, "", "Nhắn «nhận T-12» / «xong T-12 <ghi chú>»."].join("\n");
  }
  if (!result.lines.length) return "Anh/chị chưa báo ticket nào. Báo bằng cách nhắn «báo lỗi: <nội dung>».";
  return [`TICKET CỦA ANH/CHỊ (${result.lines.length} gần nhất)`, ...result.lines].join("\n");
}

export function createdReply(result: TicketCreatedResult): string {
  const short = `T-${result.ticket_id}`;
  return [
    `Dạ em đã ghi nhận ticket ${result.code}${result.attachment_count ? ` (kèm ${result.attachment_count} ảnh / tệp)` : ""}` +
      (result.handler_count ? " và đã báo người xử lý." : "; hiện chưa cài người xử lý — em đã lưu, quản trị sẽ xem trên màn Ticket."),
    `Nhắn «${short}» để xem tình hình, «${short}: <nội dung>» để bổ sung (gửi thêm ảnh trước rồi nhắn).`,
  ].join("\n");
}

export function actReply(result: TicketActOutcome): string {
  switch (result.outcome) {
    case "accepted":
      return `Dạ anh/chị đã nhận ${result.code}; em đã báo ${result.requester_name}. Xong thì nhắn «xong T-${result.ticket_id} <ghi chú>».`;
    case "closed_by_handler":
      return `Dạ đã đóng ${result.code} và báo ${result.requester_name}.`;
    case "closed_by_requester":
      return `Dạ em đã đóng ${result.code} theo báo của anh/chị. Còn vấn đề thì nhắn «T-${result.ticket_id}: <nội dung>» để mở lại.`;
    case "cancelled":
      return `Dạ đã hủy ${result.code}.`;
    case "note_sent":
      return `Dạ em đã chuyển lời nhắn tới ${result.requester_name}.`;
    case "note_added":
      return `Dạ em đã thêm vào ${result.code}${result.attachment_count ? ` (kèm ${result.attachment_count} ảnh / tệp)` : ""}` +
        `${result.reopened ? " và MỞ LẠI ticket" : ""}; người xử lý sẽ nhận được.`;
  }
}

/** Câu bot cho một lỗi nghiệp vụ; null = lỗi hệ thống / tham số (nơi gọi ném tiếp hoặc báo lỗi riêng). `ticketId` = ticket người dùng nhắc. */
export function failureReply(failure: TicketToolFailure, ticketId: number | null): string | null {
  if (failure.code === "invalid_state") return failure.message;
  if (failure.code !== "not_allowed") return null;
  if (failure.reason === "not_found") return NOT_FOUND(ticketId ?? 0);
  return (failure.reason ? NOT_ALLOWED_BY_REASON[failure.reason] : undefined) ?? null;
}
