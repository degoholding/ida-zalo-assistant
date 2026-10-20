import type { AlertAsker } from "../assistant/alert-tools.js";
import { BriefKind, ContactRole } from "../constants.js";
import { vnLocalTime } from "../schedule/work-calendar.js";
import type { BriefCommand } from "./brief-command-parser.js";

// Phần THUẦN (không DB, không MCP) của lệnh bản tin gọi tay, dùng chung đường cũ (brief-commands-legacy.ts), đường MCP (brief-commands.ts) và công cụ lõi
// `brief_request_check`: câu từ chối cố định, trần gọi / giờ, chọn loại bản tin, và nhánh «không phải người nhận» (quyết định không cần chạm DB).

/** Trần số lần gọi tay / giờ / người nhận — gọi lặp tốn token AI (điểm tin AI) + tài nguyên soạn báo cáo. */
export const BRIEF_CHAT_RATE_CAP_PER_HOUR = 6;

export const NOT_RECIPIENT = "Bản tin dành cho người nhận cảnh báo — quản trị thêm anh/chị ở màn Người nhận.";
export const RATE_LIMITED = "Anh/chị vừa gọi bản tin / báo cáo khá nhiều trong một giờ qua — thử lại sau giúp em nhé.";
export const COMPOSE_FAILED = "Em soạn bản tin bị lỗi, anh/chị thử lại sau ít phút giúp em nhé.";
export const NO_CALENDAR = "Lịch làm việc đang cấu hình sai — báo quản trị kiểm tra ở màn Cài đặt rồi thử lại giúp em.";

export function resolveBriefKind(request: BriefCommand["request"], now: Date): BriefKind.Morning | BriefKind.Evening | BriefKind.Weekly | BriefKind.Monthly {
  switch (request) {
    case "morning": return BriefKind.Morning;
    case "evening": return BriefKind.Evening;
    // «bản tin» trần: trước 12:00 trưa coi như hỏi bản sáng, sau đó là bản cuối ngày (giờ Việt Nam)
    case "auto": return vnLocalTime(now).minuteOfDay < 12 * 60 ? BriefKind.Morning : BriefKind.Evening;
    case "weekly": return BriefKind.Weekly;
    case "monthly": return BriefKind.Monthly;
  }
}

export const isPeriodicBrief = (request: BriefCommand["request"]): boolean => request === "weekly" || request === "monthly";

/**
 * Người hỏi không phải người nhận (`asker?.recipientId` rỗng): trả kết quả cuối (câu từ chối, hoặc null = để lệnh khác / mô hình xử lý tiếp).
 * Báo cáo tuần / tháng là số liệu CHUNG (không riêng tư như bản tin sáng / cuối ngày của một người nhận) — ai có vai trò đều xuất được qua công cụ AI
 * `export_report`, nên không từ chối thẳng (review phase 8, M7). Không có vai trò gì thì `export_report` cũng không dùng được — từ chối như cũ.
 */
export function refuseNonRecipient(asker: AlertAsker | null, request: BriefCommand["request"]): string | null {
  if (isPeriodicBrief(request) && asker && asker.role !== ContactRole.None) return null;
  return NOT_RECIPIENT;
}
