import { JobSkippedError } from "../jobs/job-skipped-error.js";

/** Bot đang tắt khẩn (`bot_halt`) — mọi tin gửi ra bị chặn. Là việc bị bỏ, không thử lại (gửi lại thủ công sau khi bật). */
export class BotHaltedError extends JobSkippedError {
  constructor(message = "Bot đang tắt khẩn — không gửi tin ra") {
    super(message);
    this.name = "BotHaltedError";
  }
}
