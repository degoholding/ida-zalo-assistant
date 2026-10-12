import type { ResultSetHeader } from "mysql2";
import type { AppConfig } from "../config.js";
import { JobKind, JobStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger } from "../logger.js";
import type { SettingsStore } from "../settings/settings-store.js";
import { recordAudit } from "../web/api/audit-log.js";
import { BotHaltedError } from "./bot-halted-error.js";
import type { BotHaltState, BotHaltVia } from "./bot-halt-state.js";

// Tắt bot khẩn (phase 9): MỘT cờ trung tâm `bot_halt`. Bật cờ là mọi tin gửi ra dừng ngay (chặn ở ZaloSender + bọc
// handler job + việc nền bỏ lượt); đồng bộ + lưu tin vẫn chạy. Chỉ tiến trình app ghi cờ (web API + lệnh Zalo cùng ở app).

const log = createLogger("bot-halt");
const BOT_HALT_KEY = "bot_halt";
const SWEPT_MESSAGE = "bot tắt khẩn — bỏ";

/** Mọi loại việc tiến trình app xử lý — hiện đều là gửi tin ra Zalo. Thêm loại gửi tin mới thì thêm vào đây. */
export const OUTBOUND_JOB_KINDS: readonly JobKind[] = [
  JobKind.AssistantDirectReply, JobKind.AssistantGroupReply, JobKind.RecipientMessage,
  JobKind.AlertDispatch, JobKind.ContactMessage, JobKind.SendCommandTarget,
];

export function isBotHalted(config: Pick<AppConfig, "botHalt">): boolean {
  return config.botHalt.halted;
}

/** Ném BotHaltedError nếu bot đang tắt — đặt đầu mọi handler gửi tin. */
export function assertNotHalted(config: Pick<AppConfig, "botHalt">): void {
  if (config.botHalt.halted) throw new BotHaltedError();
}

export class BotHaltControl {
  constructor(
    private readonly db: Db,
    private readonly config: Pick<AppConfig, "botHalt">,
    private readonly settings: Pick<SettingsStore, "saveInternal">,
  ) {}

  status(): BotHaltState {
    return { ...this.config.botHalt };
  }

  /** Tắt bot. Đang tắt rồi thì không làm gì, trả tình trạng hiện tại. Việc đã đến hạn trong hàng đợi → Expired. */
  async halt(actor: string, via: BotHaltVia): Promise<BotHaltState> {
    if (this.config.botHalt.halted) return this.status();
    const state: BotHaltState = { halted: true, since: new Date().toISOString(), by: actor.slice(0, 100), via };
    // Bật cờ TRONG BỘ NHỚ trước để ZaloSender chặn ngay cả khi CSDL đang lỗi (tình huống khẩn hay đi kèm sự cố) — app giữ
    // mọi phiên Zalo nên chặn ở đây là đủ; ghi CSDL lỗi thì chỉ worker (đọc cờ từ CSDL) chưa thấy, handler job ở app vẫn bỏ.
    this.config.botHalt = state;
    await this.settings.saveInternal(BOT_HALT_KEY, state as unknown as Record<string, unknown>, actor)
      .catch((error) => log.error("ghi cờ tắt bot vào CSDL lỗi — bot vẫn tắt trong tiến trình app, worker chưa thấy", error));
    const swept = await this.sweepDueJobs().catch((error) => {
      log.error("quét việc đến hạn lúc tắt bot lỗi (handler bọc vẫn bỏ từng việc)", error);
      return 0;
    });
    await this.audit("bot_halt", `Tắt bot khẩn bởi ${actor} qua ${via || "?"} (bỏ ${swept} việc đến hạn)`);
    log.warn(`BOT TẮT KHẨN bởi ${actor} qua ${via}; bỏ ${swept} việc đến hạn`);
    return this.status();
  }

  /** Bật lại bot. Đang bật rồi thì không làm gì. KHÔNG gửi bù việc đã bỏ. */
  async resume(actor: string, via: BotHaltVia): Promise<BotHaltState> {
    if (!this.config.botHalt.halted) return this.status();
    await this.settings.saveInternal(BOT_HALT_KEY, { halted: false, since: null, by: actor.slice(0, 100), via }, actor);
    await this.audit("bot_resume", `Bật lại bot bởi ${actor} qua ${via || "?"}`);
    log.warn(`bot bật lại bởi ${actor} qua ${via}`);
    return this.status();
  }

  /** Việc đã đến hạn (chưa chạy) → Expired; việc hẹn tương lai giữ nguyên. */
  private async sweepDueJobs(): Promise<number> {
    const [result] = await this.db.query<ResultSetHeader>(
      "UPDATE job SET status = ?, finished_at = NOW(3), locked_by = NULL, last_error = ? WHERE status = ? AND run_after <= NOW(3) AND kind IN (?)",
      [JobStatus.Expired, SWEPT_MESSAGE, JobStatus.Pending, [...OUTBOUND_JOB_KINDS]]);
    return result.affectedRows;
  }

  /** Nhật ký thao tác không được làm hỏng lệnh tắt / bật. */
  private async audit(action: string, message: string): Promise<void> {
    await recordAudit(this.db, { entity: "setting", entityId: 0, action, message }).catch((error) => log.warn("ghi nhật ký tắt / bật bot lỗi", error));
  }
}
