import type { AppConfig } from "./config.js";
import type { Db } from "./db/pool.js";
import { purgeFinishedJobs, recoverStaleJobs, summarizeQueue } from "./jobs/job-queue.js";
import { createLogger } from "./logger.js";
import { BACKGROUND_TASKS, type BackgroundTaskName } from "./schedule/background-tasks.js";
import { Scheduler } from "./schedule/scheduler.js";
import { buildWorkCalendar, type WorkCalendar } from "./schedule/work-calendar.js";
import { runAiReview } from "./alerts/ai-review.js";
import { runReminders } from "./alerts/reminders.js";
import { telegramSenderFor, watchSessions } from "./alerts/session-watch.js";
import { backfillMessageSearch } from "./search/message-search-index.js";
import { runTaskReminders } from "./tasks/task-reminders.js";
import { runTaskExtraction } from "./tasks/task-proposals.js";
import { uploadBackups } from "./storage/backup-uploader.js";
import type { FileStorage } from "./storage/file-storage.js";
import { cacheAvatars } from "./sync/avatar-cache.js";
import { purgeExpiredFiles, purgeExpiredMessages } from "./sync/retention.js";

// Việc nền không cần phiên Zalo, chạy bằng bộ lập lịch (src/schedule/scheduler.ts): ảnh đại diện, dọn tin + tệp gốc quá
// hạn, dọn hàng đợi, đưa bản sao lưu lên R2. Chạy ở tiến trình `worker` (src/worker.ts) khi docker compose bật nó, hoặc
// ngay trong tiến trình chính khi WORKER_EMBEDDED=true (máy dev). Danh mục việc: src/schedule/background-tasks.ts.

const log = createLogger("background");

/** Việc «đang chạy» quá ngần này mà tiến trình giữ nó không báo xong = tiến trình đã chết giữa chừng. */
const JOB_STALE_MS = 30 * 60_000;
/** Việc đã xong / bỏ giữ lại ngần này ngày để tra cứu rồi xóa. */
const JOB_KEEP_DAYS = 14;
const BACKUP_DIR = process.env.BACKUP_DIR?.trim() || "/backups";

export interface BackgroundTasks {
  stop(): void;
}

/** Lịch làm việc theo cài đặt hiện hành — dựng lại khi chuỗi cài đặt đổi. Sai cài đặt thì ném lỗi (bộ lập lịch ghi log). */
export function workCalendarFrom(config: AppConfig): () => WorkCalendar {
  let cacheKey = "";
  let cached: WorkCalendar | null = null;
  return () => {
    const key = JSON.stringify(config.calendar);
    if (!cached || key !== cacheKey) {
      cached = buildWorkCalendar(config.calendar);
      cacheKey = key;
    }
    return cached;
  };
}

export async function startBackgroundTasks(db: Db, storage: FileStorage, config: AppConfig): Promise<BackgroundTasks> {
  const runners: Record<BackgroundTaskName, () => Promise<unknown>> = {
    avatars: () => cacheAvatars(db, storage),
    retention: async () => {
      const result = await purgeExpiredMessages(db, storage);
      const files = await purgeExpiredFiles(db, storage);
      if (result.messages || result.files || files) log.info(`dọn quá hạn: ${result.messages} tin, ${result.files + files} tệp`);
    },
    "job-housekeeping": async () => {
      const recovered = await recoverStaleJobs(db, JOB_STALE_MS);
      const purged = await purgeFinishedJobs(db, JOB_KEEP_DAYS);
      const queue = await summarizeQueue(db);
      if (recovered || purged || queue.pending || queue.failedToday) {
        log.info(`hàng đợi: chờ ${queue.pending} (lâu nhất ${queue.oldestPendingSeconds} giây), đang chạy ${queue.running}, ` +
          `lỗi hôm nay ${queue.failedToday}; trả về hàng ${recovered}, xóa cũ ${purged}`);
      }
    },
    "backup-upload": () => uploadBackups(storage, BACKUP_DIR, config.backup.keepDays),
    "alert-reminders": () => runReminders(db, config, safeCalendar()),
    "alert-ai-review": () => runAiReview(db, config),
    "session-watch": () => watchSessions(db, telegramSenderFor(config)),
    "task-reminders": () => runTaskReminders(db, config, safeCalendar()),
    "task-extract": () => runTaskExtraction(db, config, safeCalendar()),
    "search-index": async () => {
      const copied = await backfillMessageSearch(db);
      if (copied) log.info(`chép ${copied} tin cũ vào bảng tìm`);
    },
  };
  const getCalendar = workCalendarFrom(config);
  // Lịch cài sai thì nhắc theo giờ thường còn hơn tắt hẳn
  const safeCalendar = () => {
    try {
      return getCalendar();
    } catch {
      return null;
    }
  };
  const scheduler = new Scheduler(db, BACKGROUND_TASKS.map((task) => ({ ...task, run: runners[task.name] })), getCalendar);
  await scheduler.start();
  return { stop: () => scheduler.stop() };
}
