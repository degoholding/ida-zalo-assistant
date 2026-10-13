import type { Db } from "../db/pool.js";
import type { JobRow } from "../jobs/job-queue.js";
import type { ContactMessagePayload } from "../messaging/contact-message.js";
import type { ReminderRepeat } from "./send-command-types.js";
import type { WorkCalendar } from "../schedule/work-calendar.js";

// Phụ thuộc tiêm vào dịch vụ lệnh gửi (phase 9) — để lõi chạy được không cần Zalo (test) và phase 4 nối vào SyncService.

export interface SendCommandDeps {
  db: Db;
  /** Lịch làm việc — cảnh báo giờ hẹn rơi giờ yên lặng / ngày nghỉ */
  calendar: WorkCalendar;
  /** Có việc mới trong hàng đợi — đánh thức bộ chạy việc */
  wakeJobs?: () => void;
  /** Đưa lại hàng tải những tệp chưa vào kho */
  requestDownload?: (attachmentIds: number[]) => void;
}

/** Payload của job `SendCommandTarget` là `{ targetId }`; khi giao thì thêm nội dung + tiến độ (xem `buildDeliveryPayload`). */
export interface SendTargetJobPayload extends ContactMessagePayload {
  targetId: number;
}

/**
 * Đường gửi thật (phase 4 nối vào `SyncService.sendContactMessage`). `payload` đã gồm `targetId` — bên cài đặt ghi tiến độ
 * (`textSent`, `sentAttachmentCount`, `sentFileCount`) bằng cách `UPDATE job SET payload` với CHÍNH đối tượng này, để lượt thử lại không gửi
 * lặp phần đã xong. Ném lỗi nếu gửi không được (bot tắt khẩn → `BotHaltedError`).
 */
export interface SendDeliveryPort {
  deliver(payload: SendTargetJobPayload, job: JobRow): Promise<void>;
  /**
   * Tạo nhắc hẹn Zalo cho nhóm, qua hàng gửi của bot (tắt khẩn → `BotHaltedError`). `request.checkExisting` = true thì phải kiểm nhóm
   * đã có nhắc hẹn cùng tiêu đề + giờ chưa rồi mới tạo — không tạo trùng khi lượt trước tạo xong mà mất kết quả. Ném lỗi nếu không tạo được.
   */
  createReminder(request: SendReminderRequest, job: JobRow): Promise<void>;
  /**
   * Ghim ghi chú lên nhóm, qua hàng gửi của bot (tắt khẩn → `BotHaltedError`). `request.checkExisting` = true thì phải liệt kê ghi chú
   * của nhóm và bỏ nếu đã có cùng nội dung — không ghim trùng khi lượt trước ghim xong mà mất kết quả. Ném lỗi nếu không ghim được.
   */
  createPin(request: SendPinRequest, job: JobRow): Promise<void>;
}

/** Một ghi chú ghim cần tạo cho một nhóm (lệnh `action_kind = 3`). */
export interface SendPinRequest {
  /** zalo_group.id của nhóm đích */
  threadId: number;
  content: string;
  /** Cùng ý nghĩa `SendReminderRequest.checkExisting`: job thử lại hoặc quản trị «gửi lại nơi lỗi» */
  checkExisting: boolean;
}

/** Một nhắc hẹn Zalo cần tạo cho một nhóm (lệnh `action_kind = 2`). `startTime` = mili-giây epoch. */
export interface SendReminderRequest {
  /** zalo_group.id của nhóm đích */
  threadId: number;
  title: string;
  startTime: number;
  repeat: ReminderRepeat;
  /**
   * Có thể đã có lượt trước tạo xong mà mất kết quả: job thử lại (`job.attempts > 1`) HOẶC quản trị «gửi lại nơi lỗi» trên web
   * (`attempt_no > 1` — job mới nên `job.attempts` lại là 1) → liệt kê nhắc hẹn của nhóm, bỏ trùng cùng tiêu đề + giờ.
   */
  checkExisting: boolean;
}

export interface SendDeliveryDeps extends SendCommandDeps {
  port: SendDeliveryPort;
}

/** Người thao tác hủy / gửi lại: người ra lệnh trên Zalo (chỉ lệnh của mình) hoặc tài khoản web (quyền kiểm ở API). */
export type SendCommandActor = { via: "zalo"; uid: string; name: string } | { via: "web"; name: string };

/** Kết quả một thao tác lệnh: `handled` = false khi «đồng ý» / «hủy» trần mà người này không có nháp nào (nơi gọi thử việc khác). */
export interface SendActionResult {
  handled: boolean;
  reply: string;
  commandId?: number;
  /** true = thao tác ĐÃ đổi dữ liệu (hủy xong / có nơi được xếp gửi) — web chỉ ghi nhật ký thao tác khi true */
  ok?: boolean;
}
