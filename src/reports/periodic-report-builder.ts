import type { ModelClient } from "../assistant/gemini-client.js";
import { HighlightCache, pickHighlights } from "../briefs/brief-ai-highlights.js";
import { aiCandidates } from "../briefs/brief-message-collectors.js";
import type { BriefLogFile, BriefPeriod, BriefScope } from "../briefs/brief-types.js";
import type { AppConfig } from "../config.js";
import { BriefKind } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { RecipientRow } from "../recipients/recipient-repository.js";
import type { FileStorage } from "../storage/file-storage.js";
import { collectMessageStats } from "./periodic-report-message-stats.js";
import type { PeriodicStatsCache } from "./periodic-report-stats-cache.js";
import type { PeriodicReportData, ReportMeta } from "./periodic-report-types.js";
import { renderPeriodicReportPdf } from "./periodic-report-template.js";
import { toPeriodicReportTable } from "./periodic-report-workbook.js";
import { collectStaffStats, collectWorkStats } from "./periodic-report-work-stats.js";
import { reportFileName, buildReportWorkbook } from "./report-table.js";
import { vnTimestamp } from "./report-exporter.js";

// Dựng báo cáo tuần / tháng cho MỘT người nhận (phase 3): gom số liệu (tin + việc/ticket/nhân viên) → điểm tin AI
// (dùng chung `pickHighlights` với bản tin, `maxPoints = 5`, luật Mật đã áp ở `scope`) → PDF 1 trang + Excel chi tiết →
// cất kho. Không chạm DB khác ngoài các bộ gom; không gửi (gửi là việc của `produceBrief` + hàng đợi job).

/** Chỉ các trường `BriefDeps` (brief-delivery.ts) thật sự cần ở đây — tránh vòng import reports ↔ briefs. */
export interface PeriodicReportDeps {
  db: Db;
  config: AppConfig;
  /** Dựng LƯỜI — chỉ gọi khi thật sự soạn báo cáo (xem `BriefDeps.client`, brief-delivery.ts). */
  client: () => Promise<ModelClient | null>;
  highlightCache: HighlightCache;
  storage: FileStorage;
  messageStatsCache: PeriodicStatsCache;
}

export interface PeriodicReportResult {
  summaryText: string;
  files: BriefLogFile[];
  /** Vì sao không có điểm tin AI (rỗng = có) — để `brief_log.ai_note` ghi đúng, không luôn rỗng (review phase 8, M9). */
  aiNote: string;
}

const EXCEL_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TITLE_PREFIX: Record<BriefKind.Weekly | BriefKind.Monthly, { file: string; label: string }> = {
  [BriefKind.Weekly]: { file: "Bao cao tuan", label: "BÁO CÁO TUẦN" },
  [BriefKind.Monthly]: { file: "Bao cao thang", label: "BÁO CÁO THÁNG" },
};

function buildSummaryText(data: PeriodicReportData, meta: ReportMeta): string {
  const t = data.totals;
  return [
    `${TITLE_PREFIX[data.kind].label} ${data.period.periodLabel} — ${meta.recipientName}`,
    `Tin: ${t.messages.current} (kỳ trước ${t.messages.previous}) · Khẩn: ${t.urgent.current} · Chờ quá giờ còn mở: ${t.waitingOverdueOpen.current}`,
    `Việc: ${t.tasksDone.current} xong · ${t.tasksOverdueOpen.current} quá hạn còn mở`,
    `Ticket: ${t.ticketsCreated.current} mới · ${t.ticketsClosed.current} đóng · ${t.ticketsOpen.current} còn mở`,
    "PDF + Excel gửi kèm",
  ].join("\n");
}

/** Báo cáo tuần / tháng cho một người nhận — dùng chung cho lịch (brief-runner.ts) lẫn gọi tay sau này (phase 4). */
export async function buildPeriodicReport(
  deps: PeriodicReportDeps, kind: BriefKind.Weekly | BriefKind.Monthly, scope: BriefScope, period: BriefPeriod,
  recipient: Pick<RecipientRow, "name">, now: Date,
): Promise<PeriodicReportResult> {
  const [messageStats, workStats, staff, candidates] = await Promise.all([
    deps.messageStatsCache.get(scope, period, now, () => collectMessageStats(deps.db, scope, period, now)),
    collectWorkStats(deps.db, scope, period, now),
    collectStaffStats(deps.db, scope, period, now),
    aiCandidates(deps.db, scope, period),
  ]);
  const highlightResult = await pickHighlights(
    { db: deps.db, config: deps.config, client: await deps.client(), cache: deps.highlightCache, scope, period, now },
    candidates, { maxPoints: 5, label: period.periodLabel },
  );

  const data: PeriodicReportData = {
    kind, period,
    totals: { ...messageStats.totals, ...workStats.totals },
    groups: messageStats.groups, staff, tasks: workStats.tasks, tickets: workStats.tickets,
  };
  const meta: ReportMeta = { recipientName: recipient.name, scopeLabel: messageStats.scopeLabel, now };

  const { text: dateText, stamp } = vnTimestamp(now);
  const folder = `reports/${stamp.slice(0, 6)}`;
  const titlePrefix = TITLE_PREFIX[kind].file;

  const pdfBytes = await renderPeriodicReportPdf(data, highlightResult.highlights, meta);
  const pdfFileName = reportFileName(titlePrefix, period.periodLabel, recipient.name, dateText.slice(0, 10), "pdf");
  const pdfStorageKey = await deps.storage.put(`${folder}/${stamp}-${pdfFileName}`, pdfBytes, "application/pdf");

  const xlsxBytes = buildReportWorkbook(toPeriodicReportTable(data, meta), dateText);
  const xlsxFileName = reportFileName(titlePrefix, period.periodLabel, recipient.name, dateText.slice(0, 10), "xlsx");
  const xlsxStorageKey = await deps.storage.put(`${folder}/${stamp}-${xlsxFileName}`, xlsxBytes, EXCEL_CONTENT_TYPE);

  const files: BriefLogFile[] = [
    { fileName: pdfFileName, storageKey: pdfStorageKey, bytes: pdfBytes.length },
    { fileName: xlsxFileName, storageKey: xlsxStorageKey, bytes: xlsxBytes.length },
  ];
  return { summaryText: buildSummaryText(data, meta), files, aiNote: highlightResult.note };
}
