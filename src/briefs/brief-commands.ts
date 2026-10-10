import type { RowDataPacket } from "mysql2";
import type { ModelClient } from "../assistant/gemini-client.js";
import type { AlertAsker } from "../assistant/alert-tools.js";
import type { AppConfig } from "../config.js";
import { BriefKind, BriefTrigger, ContactRole } from "../constants.js";
import type { Db } from "../db/pool.js";
import { findRecipient } from "../recipients/recipient-repository.js";
import { vnLocalTime, type WorkCalendar } from "../schedule/work-calendar.js";
import type { FileStorage } from "../storage/file-storage.js";
import { PeriodicStatsCache } from "../reports/periodic-report-stats-cache.js";
import { HighlightCache } from "./brief-ai-highlights.js";
import type { BriefCommand } from "./brief-command-parser.js";
import { produceBrief, type BriefDeps } from "./brief-delivery.js";

// Gọi bản tin / báo cáo NGAY bằng câu chat (phase 4) — chạy `produceBrief` giống việc nền (`brief-runner.ts`), nhưng
// MỘT người nhận mỗi lần nên dựng `BriefDeps` (lịch, client AI) riêng cho từng lượt gọi thay vì giữ sẵn cho cả lượt
// chạy. Nội dung thật (chữ bản tin, hoặc tóm tắt + PDF/Excel) luôn đi qua hàng đợi `produceBrief` đã xếp (giống lịch /
// nút web) — hàm ở đây KHÔNG trả lại chữ đó làm câu trả lời chat, tránh người nhận thấy MỘT bản tin hai lần (một lần
// làm câu trả lời tức thì, một lần do hàng đợi gửi). Trả chuỗi RỖNG khi thành công (chat-commands.ts coi là "đã xử lý,
// không cần trả lời thêm" — xem AccountRunner.answerQuestion: `reply.text` rỗng thì không gửi gì); người nhận thấy bản
// tin trong vài giây nhờ `wakeJobs()`.

/** Phụ thuộc để soạn + gửi bản tin / báo cáo khi gọi tay (chat hoặc nút web «Gửi thử bản tin», phase 4). */
export interface BriefChatDeps {
  db: Db;
  config: AppConfig;
  storage: FileStorage;
  /** Lịch làm việc hiện hành — null = cài đặt lịch đang sai (báo lỗi thay vì ném, xem background.ts `safeCalendar`). */
  calendar: () => WorkCalendar | null;
  /** Dựng client AI MỖI LẦN gọi (không giữ sẵn như `runBriefs` vì gọi tay ít hơn nhiều so với việc nền mỗi phút). */
  buildClient: () => Promise<ModelClient | null>;
  /** Đánh thức bộ chạy việc để job gửi bản tin chạy ngay, khỏi chờ vòng quét định kỳ. */
  wakeJobs?: () => void;
}

/** Trần số lần gọi tay / giờ / người nhận — gọi lặp tốn token AI (điểm tin AI) + tài nguyên soạn báo cáo. */
const RATE_CAP_PER_HOUR = 6;

const NOT_RECIPIENT = "Bản tin dành cho người nhận cảnh báo — quản trị thêm anh/chị ở màn Người nhận.";
const RATE_LIMITED = "Anh/chị vừa gọi bản tin / báo cáo khá nhiều trong một giờ qua — thử lại sau giúp em nhé.";
const COMPOSE_FAILED = "Em soạn bản tin bị lỗi, anh/chị thử lại sau ít phút giúp em nhé.";
const NO_CALENDAR = "Lịch làm việc đang cấu hình sai — báo quản trị kiểm tra ở màn Cài đặt rồi thử lại giúp em.";

function resolveBriefKind(request: BriefCommand["request"], now: Date): BriefKind.Morning | BriefKind.Evening | BriefKind.Weekly | BriefKind.Monthly {
  switch (request) {
    case "morning": return BriefKind.Morning;
    case "evening": return BriefKind.Evening;
    // «bản tin» trần: trước 12:00 trưa coi như hỏi bản sáng, sau đó là bản cuối ngày (giờ Việt Nam)
    case "auto": return vnLocalTime(now).minuteOfDay < 12 * 60 ? BriefKind.Morning : BriefKind.Evening;
    case "weekly": return BriefKind.Weekly;
    case "monthly": return BriefKind.Monthly;
  }
}

/** Số lần gọi tay (trigger Chat) trong một giờ qua của người nhận — trần chống gọi lặp tốn token AI. */
async function countRecentChatCalls(db: Db, recipientId: number, now: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM brief_log WHERE recipient_id = ? AND trigger_source = ? AND created_at > ?",
    [recipientId, BriefTrigger.Chat, new Date(now.getTime() - 3_600_000)],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Chạy lệnh bản tin / báo cáo gọi tay («bản tin sáng», «báo cáo tuần trước»…) — dùng chung cho lệnh chat
 * (chat-commands.ts) và công cụ AI `send_brief` (brief-tool.ts). `asker` null hoặc không phải người nhận đang bật →
 * câu từ chối; CHỈ kiểm ở đây (nơi gọi — chat-commands.ts / assistant-service.ts — đã chặn không cho gọi trong nhóm).
 */
export async function runBriefCommand(deps: BriefChatDeps, asker: AlertAsker | null, command: BriefCommand, now: Date): Promise<string | null> {
  const recipientId = asker?.recipientId;
  if (!recipientId) {
    // Báo cáo tuần / tháng là số liệu CHUNG (không riêng tư như bản tin sáng / cuối ngày của một người nhận) — ai có
    // vai trò đều xuất được qua công cụ AI `export_report`, nên để lệnh khác / mô hình xử lý tiếp thay vì từ chối
    // thẳng (review phase 8, M7). Không có vai trò gì (`ContactRole.None`) thì `export_report` cũng không dùng được
    // — từ chối như cũ. Kiểm thẳng `role` ở đây (không chỉ dựa `asker` khác null) để đúng ngay cả khi không qua đúng
    // `resolveAlertAsker` (alert-tools.ts, nơi giữ bất biến role=None ⇒ asker=null khi không phải người nhận).
    const isPeriodic = command.request === "weekly" || command.request === "monthly";
    if (isPeriodic && asker && asker.role !== ContactRole.None) return null;
    return NOT_RECIPIENT;
  }
  const recipient = await findRecipient(deps.db, recipientId);
  if (!recipient || !recipient.is_active) return NOT_RECIPIENT;
  const calendar = deps.calendar();
  if (!calendar) return NO_CALENDAR;
  if ((await countRecentChatCalls(deps.db, recipientId, now)) >= RATE_CAP_PER_HOUR) return RATE_LIMITED;

  const kind = resolveBriefKind(command.request, now);
  const briefDeps: BriefDeps = {
    db: deps.db, config: deps.config, calendar, storage: deps.storage,
    client: deps.buildClient, highlightCache: new HighlightCache(), messageStatsCache: new PeriodicStatsCache(),
  };
  try {
    await produceBrief(briefDeps, recipient, kind, BriefTrigger.Chat, now, { variant: command.variant });
  } catch {
    return COMPOSE_FAILED;
  }
  deps.wakeJobs?.();
  return "";
}
