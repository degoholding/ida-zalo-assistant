import type { RowDataPacket } from "mysql2";
import type { AppConfig } from "../config.js";
import { BotAccountStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";

// Báo khi phiên Zalo của bot văng (IDA câu 9): người nhận + IT nhận qua kênh dự phòng (bot Telegram) — để bot im lặng
// không bị hiểu nhầm là không có tin khẩn. Báo MỘT lần khi văng (quá 5 phút không nhịp tim / cần quét QR), một lần khi
// nối lại. Chạy ở worker 2 phút / lần.

const log = createLogger("session-watch");
const DOWN_AFTER_MS = 5 * 60_000;

export type TelegramSender = (text: string) => Promise<void>;

export function telegramSenderFor(config: AppConfig, fetcher: typeof fetch = fetch): TelegramSender | null {
  const { telegramBotToken: token, telegramChatId: chatId } = config.alerts;
  if (!token || !chatId) return null;
  return async (text) => {
    const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Telegram trả ${response.status}`);
  };
}

const VN_TIME = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", hour12: false });

export async function watchSessions(db: Db, send: TelegramSender | null, now = new Date()): Promise<{ down: number; recovered: number }> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, label, display_name, status, last_heartbeat_at, alerted_down_at FROM bot_account WHERE is_active = 1");
  let down = 0;
  let recovered = 0;
  for (const row of rows) {
    const heartbeat = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : 0;
    const isDown = Number(row.status) === BotAccountStatus.NeedsLogin || now.getTime() - heartbeat > DOWN_AFTER_MS;
    const name = String(row.display_name || row.label);
    if (isDown && !row.alerted_down_at) {
      const reason = Number(row.status) === BotAccountStatus.NeedsLogin ? "phiên hết hạn — cần quét QR lại ở màn Tài khoản bot" : "mất nhịp tim quá 5 phút";
      try {
        await send?.(`[Bot trợ lý] Tài khoản bot «${name}» MẤT KẾT NỐI Zalo (${reason}). Trong lúc này bot KHÔNG đọc được tin và không báo tin khẩn. Lần cuối thấy: ${heartbeat ? VN_TIME.format(new Date(heartbeat)) : "chưa rõ"}.`);
      } catch (error) {
        log.warn(`báo Telegram lỗi: ${describeError(error)}`);
        continue;
      }
      await db.query("UPDATE bot_account SET alerted_down_at = ? WHERE id = ?", [now, row.id]);
      log.warn(`bot «${name}» mất kết nối — đã báo${send ? "" : " (chưa cấu hình Telegram, chỉ ghi log)"}`);
      down += 1;
    } else if (!isDown && row.alerted_down_at) {
      try {
        await send?.(`[Bot trợ lý] Tài khoản bot «${name}» đã NỐI LẠI Zalo lúc ${VN_TIME.format(now)}.`);
      } catch (error) {
        log.warn(`báo Telegram lỗi: ${describeError(error)}`);
      }
      await db.query("UPDATE bot_account SET alerted_down_at = NULL WHERE id = ?", [row.id]);
      recovered += 1;
    }
  }
  return { down, recovered };
}
