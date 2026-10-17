import type { RowDataPacket } from "mysql2";
import { BotAccountKind, BotAccountStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { JobSkippedError } from "../jobs/job-skipped-error.js";
import { COLLECT_ONLY_MESSAGE } from "../zalo/collect-only-account-error.js";

// Chọn tài khoản bot GỬI được (loại Trợ lý). Tài khoản loại Normal (chỉ gom dữ liệu) không bao giờ được chọn — không có
// đường lùi về «runner đầu tiên» như trước, vì runner đầu tiên có thể là tài khoản Normal. Hàm thuần để test không cần DB.

export interface SendableCandidate {
  readonly isCollectOnly: boolean;
}

/**
 * Runner gửi được: ưu tiên theo thứ tự `preferred` (vd bot đã có cuộc với người đó), rồi tới `fallbackPool` nếu cho phép.
 * Trả null khi không có runner Trợ lý nào.
 */
export function pickSendableRunner<T extends SendableCandidate>(
  preferred: ReadonlyArray<T | undefined>,
  fallbackPool: Iterable<T> = [],
): T | null {
  for (const runner of preferred) if (runner && !runner.isCollectOnly) return runner;
  for (const runner of fallbackPool) if (!runner.isCollectOnly) return runner;
  return null;
}

/** Tài khoản Trợ lý còn dùng được về mặt lâu dài: bật, có phiên đăng nhập, không đòi quét QR lại. */
export async function countUsableAssistantAccounts(db: Db): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM bot_account
     WHERE kind = ? AND is_active = 1 AND session_cipher IS NOT NULL AND status <> ?`,
    [BotAccountKind.Assistant, BotAccountStatus.NeedsLogin]);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Lỗi khi `pickSendableRunner` trả null. BỎ việc vĩnh viễn (JobSkippedError, không thử lại) CHỈ khi trong DB không còn
 * tài khoản Trợ lý nào dùng được (bật + có phiên + không cần đăng nhập lại) — tức hệ thống thật sự chỉ có bot Normal.
 * Còn lại (bot Trợ lý chỉ đang tắt / khởi động / mất kết nối tạm) → lỗi thường, hàng đợi thử lại sau.
 */
export async function noSendableRunnerError(db: Db, context: string): Promise<Error> {
  if ((await countUsableAssistantAccounts(db)) === 0) return new JobSkippedError(`${context}: ${COLLECT_ONLY_MESSAGE}`);
  return new Error(`chưa có tài khoản bot Trợ lý nào đang chạy${context ? ` (${context})` : ""} — thử lại sau`);
}
