import type { AlertAsker } from "../assistant/alert-tools.js";
import type { ModelClient } from "../assistant/gemini-client.js";
import type { AskerAccess } from "../assistant/infra/asker-access.js";
import type { AssistantMcpTurn } from "../assistant/mcp-bridge/assistant-mcp-turn.js";
import type { AppConfig } from "../config.js";
import { BriefTrigger } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { RecipientRow } from "../recipients/recipient-repository.js";
import { PeriodicStatsCache } from "../reports/periodic-report-stats-cache.js";
import type { WorkCalendar } from "../schedule/work-calendar.js";
import { withCommandSession } from "../send-commands/send-command-session.js";
import type { FileStorage } from "../storage/file-storage.js";
import { HighlightCache } from "./brief-ai-highlights.js";
import type { BriefCommand } from "./brief-command-parser.js";
import { COMPOSE_FAILED, NOT_RECIPIENT, NO_CALENDAR, RATE_LIMITED, refuseNonRecipient, resolveBriefKind } from "./brief-command-support.js";
import { runBriefCommandLegacy } from "./brief-commands-legacy.js";
import { produceBrief, type BriefDeps } from "./brief-delivery.js";

// Gọi bản tin / báo cáo NGAY bằng câu chat (phase 4) — chạy `produceBrief` giống việc nền (`brief-runner.ts`), nhưng MỘT người nhận mỗi lần nên dựng
// `BriefDeps` (lịch, client AI) riêng cho từng lượt gọi. Nội dung thật (chữ bản tin, hoặc tóm tắt + PDF/Excel) luôn đi qua hàng đợi `produceBrief` đã xếp
// — hàm ở đây KHÔNG trả lại chữ đó làm câu trả lời chat, tránh người nhận thấy MỘT bản tin hai lần. Trả chuỗi RỖNG khi thành công (chat-commands.ts coi là
// «đã xử lý, không cần trả lời thêm»). Phase 12: phần TRA DỮ LIỆU (người nhận đang bật, trần gọi / giờ trên `brief_log`) đi qua công cụ lệnh
// `brief_request_check` khi họ `send` bật; dựng + gửi bản tin (thu thập, điểm tin AI, PDF / Excel, hàng đợi Zalo) là pipeline hệ thống, vẫn tiêm như cũ (O6).

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
  /**
   * Nguồn phiên MCP của lượt (nơi dựng đặt theo lượt, `{ ...briefs, mcp, access }`): `mcp` = phiên lệnh dùng chung (nơi mở lo đóng); chỉ `access` = mỗi lần tự mở
   * phiên rồi đóng. Thiếu cả hai (nút web, việc nền, test cũ) = đường cũ brief-commands-legacy.ts.
   */
  mcp?: () => Promise<AssistantMcpTurn | undefined>;
  access?: () => Promise<AskerAccess>;
}

type BriefCheck =
  | { outcome: "ok"; recipient: RecipientRow }
  | { outcome: "not_recipient" } | { outcome: "no_calendar" } | { outcome: "rate_limited" } | { outcome: "passthrough" };

/**
 * Chạy lệnh bản tin / báo cáo gọi tay («bản tin sáng», «báo cáo tuần trước»…) — dùng chung cho lệnh chat (chat-commands.ts) và công cụ AI `send_brief`
 * (brief-tool.ts). `asker` null hoặc không phải người nhận đang bật → câu từ chối; CHỈ kiểm ở đây (nơi gọi đã chặn không cho gọi trong nhóm).
 */
export async function runBriefCommand(deps: BriefChatDeps, asker: AlertAsker | null, command: BriefCommand, now: Date): Promise<string | null> {
  if (!asker?.recipientId) return refuseNonRecipient(asker, command.request);
  // Lịch chỉ hỏi khi đi đường MCP (đường cũ tự hỏi lại đúng chỗ của nó, sau bước tra người nhận)
  let calendar: WorkCalendar | null = null;
  const checked = await withCommandSession({ mcp: deps.mcp, access: deps.access, deps }, ["brief_request_check"], async (call) => {
    calendar = deps.calendar();
    return await call("brief_request_check", { request: command.request, calendar_available: calendar !== null }) as unknown as BriefCheck;
  });
  if (!checked) return runBriefCommandLegacy(deps, asker, command, now);
  const check = checked.value;
  if (check.outcome === "passthrough") return null;
  if (check.outcome === "not_recipient") return NOT_RECIPIENT;
  if (check.outcome === "no_calendar") return NO_CALENDAR;
  if (check.outcome === "rate_limited") return RATE_LIMITED;
  const activeCalendar = calendar as WorkCalendar | null;
  if (!activeCalendar) return NO_CALENDAR;

  const briefDeps: BriefDeps = {
    db: deps.db, config: deps.config, calendar: activeCalendar, storage: deps.storage,
    client: deps.buildClient, highlightCache: new HighlightCache(), messageStatsCache: new PeriodicStatsCache(),
  };
  try {
    await produceBrief(briefDeps, check.recipient, resolveBriefKind(command.request, now), BriefTrigger.Chat, now, { variant: command.variant });
  } catch {
    return COMPOSE_FAILED;
  }
  deps.wakeJobs?.();
  return "";
}
