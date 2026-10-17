import type { ResultSetHeader } from "mysql2";
import type { AppConfig } from "./config.js";
import type { Db } from "./db/pool.js";
import { purgeFinishedJobs, recoverStaleJobs, summarizeQueue } from "./jobs/job-queue.js";
import { createLogger } from "./logger.js";
import { isBotHalted } from "./messaging/bot-halt.js";
import { BACKGROUND_TASKS, type BackgroundTaskName } from "./schedule/background-tasks.js";
import { Scheduler } from "./schedule/scheduler.js";
import { buildWorkCalendar, type WorkCalendar } from "./schedule/work-calendar.js";
import { buildAlertModelClient, runAiReview } from "./alerts/ai-review.js";
import { runImageAutoRead } from "./alerts/image-auto-read.js";
import { runReminders } from "./alerts/reminders.js";
import { telegramSenderFor, watchSessions } from "./alerts/session-watch.js";
import { runBriefs } from "./briefs/brief-runner.js";
import { runMetricsSync } from "./metrics/metric-sync-runner.js";
import { MeetingScheduler } from "./google/calendar-meetings.js";
import { runMeetingRecapProcessing, runMeetingRecordings } from "./meetings/meeting-recording-watcher.js";
import { backfillMessageSearch } from "./search/message-search-index.js";
import { runSendCommandWatch } from "./send-commands/send-command-watch.js";
import { runTaskReminders } from "./tasks/task-reminders.js";
import { runTaskExtraction } from "./tasks/task-proposals.js";
import { uploadBackups } from "./storage/backup-uploader.js";
import type { FileStorage } from "./storage/file-storage.js";
import { cacheAvatars } from "./sync/avatar-cache.js";
import { purgeOldDrafts } from "./data-access/write/write-draft-store.js";
import { purgeExpiredFiles, purgeExpiredMessages } from "./sync/retention.js";

// Việc nền không cần phiên Zalo, chạy bằng bộ lập lịch (src/schedule/scheduler.ts): ảnh đại diện, dọn tin + tệp gốc quá
// hạn, dọn hàng đợi, đưa bản sao lưu lên R2. Chạy ở tiến trình `worker` (src/worker.ts) khi docker compose bật nó, hoặc
// ngay trong tiến trình chính khi WORKER_EMBEDDED=true (máy dev). Danh mục việc: src/schedule/background-tasks.ts.

const log = createLogger("background");

/** Việc «đang chạy» quá ngần này mà tiến trình giữ nó không báo xong = tiến trình đã chết giữa chừng. */
const JOB_STALE_MS = 30 * 60_000;
/** Việc đã xong / bỏ giữ lại ngần này ngày để tra cứu rồi xóa. */
const JOB_KEEP_DAYS = 14;
/** Nháp ghi (mcp_write_draft) giữ ngần này ngày rồi xóa. */
const MCP_WRITE_DRAFT_KEEP_DAYS = 7;
/** Nhật ký gọi MCP (mcp_call_log) giữ ngần này ngày. */
const MCP_CALL_LOG_KEEP_DAYS = 180;
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
  // Đọc lại config.google lúc gọi (khuôn giống MeetingScheduler của assistant) — «Kết nối Google» / ngắt kết nối trên
  // Cài đặt có hiệu lực ngay, không cần khởi động lại worker.
  const meetingScheduler = new MeetingScheduler(() => config.google);
  const runners: Record<BackgroundTaskName, () => Promise<unknown>> = {
    avatars: () => cacheAvatars(db, storage),
    retention: async () => {
      const result = await purgeExpiredMessages(db, storage);
      const files = await purgeExpiredFiles(db, storage);
      if (result.messages || result.files || files) log.info(`dọn quá hạn: ${result.messages} tin, ${result.files + files} tệp`);
      // Nhật ký gọi MCP giữ 180 ngày; xóa từng mẻ nhỏ để không khóa bảng lâu
      const [callLog] = await db.query<ResultSetHeader>(`DELETE FROM mcp_call_log WHERE created_at < NOW() - INTERVAL ${MCP_CALL_LOG_KEEP_DAYS} DAY LIMIT 10000`);
      if (callLog.affectedRows) log.info(`dọn nhật ký gọi MCP: ${callLog.affectedRows} dòng`);
      // Nháp ghi qua MCP / trợ lý (phase 8): đã dùng hay hết hạn đều xóa sau vài ngày
      const drafts = await purgeOldDrafts(db, MCP_WRITE_DRAFT_KEEP_DAYS);
      if (drafts) log.info(`dọn nháp ghi MCP: ${drafts} dòng`);
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
    "image-auto-read": () => runImageAutoRead(db, storage, config),
    "session-watch": () => watchSessions(db, telegramSenderFor(config)),
    "task-reminders": () => runTaskReminders(db, config, safeCalendar()),
    "task-extract": () => runTaskExtraction(db, config, safeCalendar()),
    briefs: () => runBriefs(db, config, safeCalendar(), storage),
    "meeting-recordings": () => runMeetingRecordings(db, config, meetingScheduler, {
      storage, calendar: safeCalendar(), buildModel: () => buildAlertModelClient(db, config),
    }),
    // Phase 6: xử lý TỐI ĐA MỘT dòng Queued, KHÔNG quét Drive — độc lập với `meeting_auto_recap_enabled` (xem
    // recapInfraReady trong meeting-recording-watcher.ts) để ghi âm xếp hàng qua chat vẫn được gỡ băng dù tắt quét tự động.
    "meeting-recap-process": () => runMeetingRecapProcessing(db, config, { storage, calendar: safeCalendar(), buildModel: () => buildAlertModelClient(db, config) }),
    // Lưới đỡ lệnh gửi (phase 9): nháp hết hạn, nơi mắc kẹt, báo kết quả bù. Lịch chỉ lệnh của app dùng (đọc lúc dùng — việc này không dùng tới)
    "send-command-watch": () => runSendCommandWatch({ db, get calendar() { return getCalendar(); } }),
    // Số liệu N3 (phase 10): chỉ đọc bảng Drive. Lỗi từng nguồn thành trạng thái nguồn, không làm sập việc nền
    "metrics-sync": () => runMetricsSync(db, config, safeCalendar(), "sync"),
    "metrics-close": () => runMetricsSync(db, config, safeCalendar(), "close"),
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
  // Bot đang tắt khẩn (phase 9): việc có thể gửi tin bỏ lượt (bản tin tự gửi bù trong ngày khi bật lại; nhắc việc / cảnh báo
  // quét lại ở lượt sau). Worker đọc lại cờ mỗi 60 giây; việc xếp trong khoảng trễ đó vẫn bị app bỏ ở handler job.
  let loggedHaltSince: string | null = null;
  const guarded = (task: (typeof BACKGROUND_TASKS)[number]): (() => Promise<unknown>) => {
    const run = runners[task.name];
    if (!("sendsMessages" in task) || !task.sendsMessages) return run;
    return async () => {
      if (isBotHalted(config)) {
        // Ghi log một lần mỗi lượt tắt, tránh dội log mỗi phút
        if (loggedHaltSince !== config.botHalt.since) {
          loggedHaltSince = config.botHalt.since;
          log.info(`bot đang tắt khẩn — các việc nền gửi tin bỏ lượt (đầu tiên: «${task.label}»)`);
        }
        return;
      }
      return run();
    };
  };
  const scheduler = new Scheduler(db, BACKGROUND_TASKS.map((task) => ({ ...task, run: guarded(task) })), getCalendar);
  await scheduler.start();
  return { stop: () => scheduler.stop() };
}
