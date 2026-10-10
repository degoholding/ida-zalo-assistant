import type { ModelClient } from "../assistant/gemini-client.js";
import type { AppConfig } from "../config.js";
import { BriefKind, type BriefTrigger } from "../constants.js";
import type { Db } from "../db/pool.js";
import { describeError } from "../logger.js";
import { enqueueRecipientMessage, type RecipientRow } from "../recipients/recipient-repository.js";
import { buildPeriodicReport } from "../reports/periodic-report-builder.js";
import type { PeriodicStatsCache } from "../reports/periodic-report-stats-cache.js";
import type { WorkCalendar } from "../schedule/work-calendar.js";
import type { FileStorage } from "../storage/file-storage.js";
import { HighlightCache, pickHighlights } from "./brief-ai-highlights.js";
import { claimBriefLog, markBriefFailed, saveComposed } from "./brief-log-repository.js";
import { aiCandidates, urgentHandledCount, urgentOpen, waitingOpen, waitingOverdue } from "./brief-message-collectors.js";
import { briefPeriod, type BriefPeriodVariant } from "./brief-period.js";
import { loadBriefScope } from "./brief-scope.js";
import { composeEveningBrief, composeMorningBrief, type BriefComposeData } from "./brief-compose.js";
import type { BriefLogFile, BriefPeriod, BriefScope } from "./brief-types.js";
import { taskBuckets, ticketBuckets } from "./brief-work-collectors.js";

// Soạn + gửi MỘT bản tin / báo cáo cho MỘT người nhận — điểm vào dùng chung cho lịch (brief-runner.ts), câu chat và
// nút «Gửi thử bản tin» trên web (khuôn «một service cho Zalo + web» của ticket / việc, chốt 09/10/2026). Bản tin sáng /
// cuối ngày (`BriefKind.Morning | Evening`, phase 2) soạn CHỮ rồi xếp MỘT job; báo cáo tuần / tháng (`Weekly | Monthly`,
// phase 3) gọi `buildPeriodicReport` (PDF + Excel, src/reports/) rồi xếp CHUNG một job (chữ + mọi tệp, review phase 8
// M2+M3) — `sendRecipientMessage` (sync-service.ts) gửi tuần tự chữ rồi từng tệp, chỉ đánh dấu `brief_log` Sent sau
// khi xong hết, và ghi Failed kèm lỗi khi job hết lượt thử / hết hạn hàng đợi (xem `reconcileExpiredBriefJobs`).

export interface BriefDeps {
  db: Db;
  config: AppConfig;
  calendar: WorkCalendar;
  /**
   * Dựng khóa AI — LƯỜI (chỉ gọi lần ĐẦU thật sự cần, tức sau khi `claimBriefLog` giành được lượt soạn), nhớ lại cho cả
   * lượt chạy để nhiều người nhận dùng chung MỘT client (review phase 8, Low: trước đây dựng mỗi phút kể cả lúc
   * `due` chỉ toàn lượt đã gửi / đang chờ trong khung bù, chưa chắc soạn gì). `null` = chưa có khóa AI.
   */
  client: () => Promise<ModelClient | null>;
  highlightCache: HighlightCache;
  /** Cất PDF / Excel báo cáo tuần / tháng (phase 3) — bản tin sáng / cuối ngày không dùng. */
  storage: FileStorage;
  /** Đệm số liệu tin của báo cáo tuần / tháng theo phạm vi trong cùng một lượt chạy (review phase 8, M11). */
  messageStatsCache: PeriodicStatsCache;
}

/** Báo cáo tuần / tháng gọi lại gửi — tệp hết hạn 12 giờ (không cần gấp như cảnh báo / bản tin, xem phase-03 N6). */
const REPORT_FILE_EXPIRES_MS = 12 * 60 * 60_000;

export interface ProduceBriefOptions {
  /** "current" = tính kỳ tới hiện tại thay vì kỳ đã xong — chỉ dùng khi gọi tay «báo cáo kỳ này» (phase 4). */
  variant?: BriefPeriodVariant;
}

export interface ProducedBrief {
  logId: number;
  text: string;
  /** PDF / Excel đính kèm — luôn rỗng ở bản tin sáng / cuối ngày, có giá trị từ phase 3 (báo cáo tuần / tháng). */
  files: BriefLogFile[];
}

async function gatherDailyBriefData(
  deps: BriefDeps, scope: BriefScope, period: BriefPeriod, kind: BriefKind.Morning | BriefKind.Evening, now: Date,
): Promise<BriefComposeData> {
  const isEvening = kind === BriefKind.Evening;
  const [urgentOpenBucket, waitingOverdueBucket, waitingOpenBucket, urgentHandled, tasks, tickets, candidates] = await Promise.all([
    urgentOpen(deps.db, scope, now),
    waitingOverdue(deps.db, scope, now),
    isEvening ? waitingOpen(deps.db, scope, now) : Promise.resolve({ total: 0, items: [] }),
    isEvening ? urgentHandledCount(deps.db, scope, period) : Promise.resolve(0),
    taskBuckets(deps.db, scope, period, deps.calendar, now),
    ticketBuckets(deps.db, scope, period),
    aiCandidates(deps.db, scope, period),
  ]);
  const highlightResult = await pickHighlights(
    { db: deps.db, config: deps.config, client: await deps.client(), cache: deps.highlightCache, scope, period, now },
    candidates,
    { maxPoints: 3, label: kind === BriefKind.Morning ? "hôm qua" : "hôm nay" },
  );
  return {
    urgentOpen: urgentOpenBucket, urgentHandledCount: urgentHandled, waitingOverdue: waitingOverdueBucket, waitingOpen: waitingOpenBucket,
    tasks, tickets, highlights: highlightResult.highlights, aiNote: highlightResult.note,
  };
}

/**
 * Soạn (nếu chưa soạn trong kỳ) + xếp hàng gửi một bản tin cho `recipient`. `null` = bỏ qua lượt này (đã soạn / đang
 * soạn / đã lỗi trong kỳ — chỉ lượt theo lịch mới chặn, xem `claimBriefLog`). Lỗi soạn thì ghi `Failed` rồi ném tiếp để
 * nơi gọi (runner / lệnh chat / API web) tự quyết cách báo người dùng.
 */
export async function produceBrief(
  deps: BriefDeps, recipient: RecipientRow, kind: BriefKind, trigger: BriefTrigger, now: Date, opts: ProduceBriefOptions = {},
): Promise<ProducedBrief | null> {
  const period = briefPeriod(kind, now, deps.calendar, opts.variant ?? "standard");
  const claim = await claimBriefLog(deps.db, {
    recipientId: recipient.id, kind, trigger, periodKey: period.periodKey, periodLabel: period.periodLabel, now,
  });
  if (!claim.claimed) return null;
  try {
    const scope = await loadBriefScope(deps.db, recipient);
    if (kind === BriefKind.Weekly || kind === BriefKind.Monthly) {
      const { summaryText, files, aiNote } = await buildPeriodicReport(deps, kind, scope, period, recipient, now);
      await saveComposed(deps.db, claim.logId, summaryText, aiNote, files);
      await enqueuePeriodicReportJob(deps.db, recipient.id, claim.logId, summaryText, files);
      return { logId: claim.logId, text: summaryText, files };
    }
    const data = await gatherDailyBriefData(deps, scope, period, kind, now);
    const ctx = { recipientName: recipient.name, now };
    const text = kind === BriefKind.Morning ? composeMorningBrief(data, ctx) : composeEveningBrief(data, ctx);
    await saveComposed(deps.db, claim.logId, text, data.aiNote);
    await enqueueRecipientMessage(deps.db, { recipientId: recipient.id, text, briefLogId: claim.logId }, `brief:${claim.logId}`);
    return { logId: claim.logId, text, files: [] };
  } catch (error) {
    await markBriefFailed(deps.db, claim.logId, describeError(error));
    throw error;
  }
}

/**
 * MỘT job DUY NHẤT gửi chữ tóm tắt rồi tới từng tệp (review phase 8, M2+M3 — trước đây tách nhiều job cùng
 * `serialKey` nên job chữ lỗi bị lùi `run_after` trong khi job tệp (đứng sau nhưng chưa lỗi) chạy trước, đảo thứ tự;
 * job tệp CUỐI lại đánh dấu Sent dù chữ chưa chắc đã gửi xong). `sendRecipientMessage` (sync-service.ts) tự ghi tiến
 * độ (`textSent` / `sentFileCount`) vào CHÍNH payload của job này sau mỗi phần gửi xong, nên thử lại không gửi lặp
 * phần đã xong, và chỉ đánh dấu `brief_log` Sent sau khi gửi hết chữ + mọi tệp.
 */
async function enqueuePeriodicReportJob(db: Db, recipientId: number, logId: number, summaryText: string, files: BriefLogFile[]): Promise<void> {
  await enqueueRecipientMessage(db,
    { recipientId, text: summaryText, reportFiles: files, briefLogId: logId }, `brief:${logId}`, REPORT_FILE_EXPIRES_MS);
}
