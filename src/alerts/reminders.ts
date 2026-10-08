import type { AppConfig } from "../config.js";
import { AlertKind } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger } from "../logger.js";
import { enqueueRecipientMessage } from "../recipients/recipient-repository.js";
import type { WorkCalendar } from "../schedule/work-calendar.js";
import { composeReminder, loadAlertSetup, overdueItems, recordAlertBatch, remindersSentToday } from "./alert-store.js";

// Nhắc tin chờ trả lời quá giờ (phase 5, IDA câu 7 + 9) — worker chạy mỗi phút. Không nhắc trong giờ yên lặng (21:00–06:30,
// Chủ nhật, lễ): tin vẫn quá hạn nên lượt đầu sau giờ yên lặng sẽ nhắc (hoặc vào bản tin sáng — phase 8). Mỗi người nhận
// tối đa `dailyReminderCap` LẦN nhắc / ngày; một lần nhắc gom nhiều tin. Gửi qua hàng đợi → app gửi bằng phiên Zalo.

const log = createLogger("alert-remind");

export async function runReminders(db: Db, config: AppConfig, calendar: WorkCalendar | null, now = new Date()): Promise<number> {
  if (!config.alerts.enabled || config.alerts.dailyReminderCap <= 0) return 0;
  if (calendar?.isQuietTime(now)) return 0;
  const setup = await loadAlertSetup(db, config);
  let sent = 0;
  for (const recipient of setup.recipients) {
    if (await remindersSentToday(db, recipient.id, now) >= config.alerts.dailyReminderCap) continue;
    const items = await overdueItems(db, recipient, now);
    if (!items.length) continue;
    await enqueueRecipientMessage(db, { recipientId: recipient.id, text: composeReminder(items, now) });
    await recordAlertBatch(db, recipient.id, AlertKind.Reminder, items.map((item) => item.messageId));
    sent += 1;
    log.info(`nhắc người nhận «${recipient.name}»: ${items.length} tin chờ quá giờ`);
  }
  return sent;
}
