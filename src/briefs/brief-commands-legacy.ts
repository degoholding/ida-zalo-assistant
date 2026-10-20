// mcp-guard: legacy(send) — đường cũ của lệnh bản tin: tra người nhận / nhật ký bản tin trực tiếp (họ `send` bật thì brief-commands.ts hỏi công cụ `brief_request_check`); gỡ ở phase 13
import type { RowDataPacket } from "mysql2";
import type { AlertAsker } from "../assistant/alert-tools.js";
import { BriefTrigger } from "../constants.js";
import type { Db } from "../db/pool.js";
import { findRecipient } from "../recipients/recipient-repository.js";
import { PeriodicStatsCache } from "../reports/periodic-report-stats-cache.js";
import { HighlightCache } from "./brief-ai-highlights.js";
import type { BriefCommand } from "./brief-command-parser.js";
import { BRIEF_CHAT_RATE_CAP_PER_HOUR, COMPOSE_FAILED, NOT_RECIPIENT, NO_CALENDAR, RATE_LIMITED, refuseNonRecipient, resolveBriefKind } from "./brief-command-support.js";
import type { BriefChatDeps } from "./brief-commands.js";
import { produceBrief, type BriefDeps } from "./brief-delivery.js";

// Đường CŨ của lệnh bản tin gọi tay (phase 4): `runBriefCommand` (brief-commands.ts) chạy hàm này khi họ `send` tắt / chưa có nguồn phiên MCP.

/** Số lần gọi tay (trigger Chat) trong một giờ qua của người nhận — trần chống gọi lặp tốn token AI. */
async function countRecentChatCalls(db: Db, recipientId: number, now: Date): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM brief_log WHERE recipient_id = ? AND trigger_source = ? AND created_at > ?",
    [recipientId, BriefTrigger.Chat, new Date(now.getTime() - 3_600_000)],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function runBriefCommandLegacy(deps: BriefChatDeps, asker: AlertAsker | null, command: BriefCommand, now: Date): Promise<string | null> {
  const recipientId = asker?.recipientId;
  if (!recipientId) return refuseNonRecipient(asker, command.request);
  const recipient = await findRecipient(deps.db, recipientId);
  if (!recipient || !recipient.is_active) return NOT_RECIPIENT;
  const calendar = deps.calendar();
  if (!calendar) return NO_CALENDAR;
  if ((await countRecentChatCalls(deps.db, recipientId, now)) >= BRIEF_CHAT_RATE_CAP_PER_HOUR) return RATE_LIMITED;

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
