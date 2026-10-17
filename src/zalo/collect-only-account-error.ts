import { JobSkippedError } from "../jobs/job-skipped-error.js";

/** Lời báo ra giao diện / log khi cần gửi mà không có bot Trợ lý nào. */
export const COLLECT_ONLY_MESSAGE = "Bot này chỉ thu thập dữ liệu, không gửi được";

/**
 * Tài khoản bot loại Normal (chỉ gom dữ liệu) bị chặn gửi ở `ZaloSender`. Là việc bị bỏ, KHÔNG thử lại (kế thừa
 * JobSkippedError): tài khoản này sẽ không bao giờ gửi được cho tới khi quản trị đổi loại.
 */
export class CollectOnlyAccountError extends JobSkippedError {
  constructor(message = COLLECT_ONLY_MESSAGE) {
    super(message);
    this.name = "CollectOnlyAccountError";
  }
}
