import { buildAlertModelClient } from "../alerts/ai-review.js";
import type { ModelClient } from "../assistant/gemini-client.js";
import type { AppConfig } from "../config.js";
import { BriefKind, BriefTrigger } from "../constants.js";
import type { Db } from "../db/pool.js";
import { createLogger, describeError } from "../logger.js";
import { listActiveRecipients } from "../recipients/recipient-repository.js";
import { PeriodicStatsCache } from "../reports/periodic-report-stats-cache.js";
import type { WorkCalendar } from "../schedule/work-calendar.js";
import type { FileStorage } from "../storage/file-storage.js";
import { HighlightCache } from "./brief-ai-highlights.js";
import { reconcileExpiredBriefJobs } from "./brief-log-repository.js";
import { produceBrief, type BriefDeps } from "./brief-delivery.js";
import { isDailyBriefDue, isPeriodicReportDue } from "./brief-due.js";

// Việc nền «briefs» (mỗi phút, src/background.ts) — bản tin sáng / cuối ngày (phase 2) + báo cáo tuần / tháng (phase 3).
// Giờ hẹn bản tin khác nhau từng người nhận nên xét TỪNG người ở đây thay vì dùng `spec: day` chung của bộ lập lịch
// (scheduler.ts); báo cáo tuần / tháng giờ CHUNG (08:00 T2 / ngày 3) nên chỉ xét đến hạn MỘT lần cho cả lượt.

const log = createLogger("briefs");

export interface RunBriefsResult {
  due: number;
  sent: number;
  failed: number;
}

/** Soạn tuần tự từng người đến hạn — lỗi một người (vd AI treo) không chặn người sau (try/catch riêng, xem Risks phase 2). */
export async function runBriefs(
  db: Db, config: AppConfig, calendar: WorkCalendar | null, storage: FileStorage, now: Date = new Date(),
): Promise<RunBriefsResult> {
  // Job gửi bản tin / báo cáo đã hết hạn hàng đợi (claimJobs tự chuyển Pending → Expired) không bao giờ chạm bộ xử lý
  // (sync-service.ts) nên brief_log vẫn kẹt Queued mãi — dọn mỗi lượt, kể cả lượt này không ai tới hạn (review phase 8, M3).
  await reconcileExpiredBriefJobs(db, now);
  if (!calendar) return { due: 0, sent: 0, failed: 0 };
  const recipients = await listActiveRecipients(db);
  const periodicKinds: BriefKind[] = config.briefs.periodicReportsEnabled
    ? [BriefKind.Weekly, BriefKind.Monthly].filter((kind) => isPeriodicReportDue(kind as BriefKind.Weekly | BriefKind.Monthly, now, calendar))
    : [];
  const due = recipients.flatMap((recipient) => {
    const kinds: BriefKind[] = [...periodicKinds];
    if (isDailyBriefDue(BriefKind.Morning, recipient.morning_brief_at, now, calendar)) kinds.push(BriefKind.Morning);
    if (isDailyBriefDue(BriefKind.Evening, recipient.evening_brief_at, now, calendar)) kinds.push(BriefKind.Evening);
    return kinds.map((kind) => ({ recipient, kind }));
  });
  if (!due.length) return { due: 0, sent: 0, failed: 0 };

  // Một client AI cho cả lượt — dựng LƯỜI (chỉ lần đầu một produceBrief nào đó thật sự giành được lượt soạn, review
  // phase 8 Low: trước đây dựng mỗi phút kể cả khi `due` toàn lượt đã gửi / đang chờ trong khung bù, không dùng tới).
  // HighlightCache gộp người nhận cùng phạm vi thành một lượt gọi (xem Key insights phase 2).
  let clientPromise: Promise<ModelClient | null> | null = null;
  const getClient = (): Promise<ModelClient | null> => (clientPromise ??= buildAlertModelClient(db, config));
  const deps: BriefDeps = {
    db, config, calendar, client: getClient, highlightCache: new HighlightCache(),
    messageStatsCache: new PeriodicStatsCache(), storage,
  };
  let sent = 0;
  let failed = 0;
  for (const { recipient, kind } of due) {
    try {
      const result = await produceBrief(deps, recipient, kind, BriefTrigger.Schedule, now);
      if (result) sent += 1;
    } catch (error) {
      failed += 1;
      log.error(`soạn bản tin lỗi (người nhận #${recipient.id}, loại ${kind})`, describeError(error));
    }
  }
  if (sent || failed) log.info(`bản tin: ${sent}/${due.length} đã xếp hàng gửi${failed ? `, ${failed} lỗi` : ""}`);
  return { due: due.length, sent, failed };
}
