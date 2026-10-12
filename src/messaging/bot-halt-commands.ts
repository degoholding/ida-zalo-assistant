import { resolveAlertAsker } from "../assistant/alert-tools.js";
import type { Db } from "../db/pool.js";
import { canHaltBot, canResumeBot } from "../send-commands/send-command-permissions.js";
import type { ContactRow } from "../sync/contact-repository.js";
import { parseBotHaltCommand } from "./bot-halt-command-parser.js";
import type { BotHaltControl } from "./bot-halt.js";
import type { BotHaltState } from "./bot-halt-state.js";

// Cổng lệnh tắt / bật / tình trạng bot trên tin riêng Zalo (phase 9). Chạy NGAY trong luồng nhận tin, trước hàng đợi
// trả lời — lúc khẩn hàng đợi có thể đang tắc chính vì sự cố. Câu trả lời đi mức ưu tiên "control" (qua được cờ tắt).
// Người lạ (không có vai trò, không là người nhận) im lặng như mọi tin riêng khác — không lộ ra bot có lệnh này.

export interface HaltGateContext {
  db: Db;
  control: BotHaltControl;
}

export interface HaltGateResult {
  /** Câu bot gửi lại (mức "control"); null = không gửi gì. */
  reply: string | null;
  /** true = tin đã xử lý xong, KHÔNG xếp việc trả lời (lệnh bot, hoặc bot đang tắt). */
  consumed: boolean;
}

const PASS: HaltGateResult = { reply: null, consumed: false };
const VN_TIME = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false });
// en-GB cho ra «12/10» (vi-VN cho «12-10»)
const VN_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" });

/** Mỗi người chỉ nhận MỘT câu «tạm dừng» trong một lượt tắt: khóa `since|uid`; sang lượt tắt mới thì xóa hết. */
const pauseNoticed = new Set<string>();
let noticedForSince = "";

export function formatHaltTime(iso: string | null): string {
  return iso ? VN_TIME.format(new Date(iso)) : "";
}

/** Câu tình trạng — hàm thuần. */
export function describeBotStatus(state: BotHaltState): string {
  if (!state.halted) return "Bot đang BẬT, gửi tin bình thường.";
  const via = state.via === "zalo" ? " qua Zalo" : state.via === "web" ? " qua web" : "";
  const since = state.since ? new Date(state.since) : null;
  return `Bot đang TẮT từ ${formatHaltTime(state.since)} ${since ? VN_DAY.format(since) : ""}${state.by ? ` (bởi ${state.by}${via})` : ""}. ` +
    "Bot vẫn đọc và lưu tin; người nhận nhắn «bật bot» để bật lại.";
}

export function haltedReply(state: BotHaltState): string {
  return `Đã TẮT bot lúc ${formatHaltTime(state.since)} — mọi tin gửi ra dừng ngay (trả lời, lệnh gửi, nhắc việc, cảnh báo, bản tin). ` +
    "Bot vẫn đọc + lưu tin. Người nhận nhắn «bật bot» để bật lại.";
}

export const RESUMED_REPLY = "Đã BẬT lại bot. Tin đến hạn trong lúc tắt đã bỏ, không gửi bù; lệnh gửi lỗi xem ở màn «Gửi tin».";
export const RESUME_DENIED_REPLY = "Chỉ người nhận cảnh báo hoặc quản trị web bật lại được.";

export function pausedReply(state: BotHaltState): string {
  return `Bot đang tạm dừng gửi tin từ ${formatHaltTime(state.since)}. Tin của anh/chị đã được lưu.`;
}

/** Xử lý một tin riêng dạng chữ. Gọi sau khi tin đã lưu. */
export async function handleHaltGate(ctx: HaltGateContext, contact: ContactRow, text: string): Promise<HaltGateResult> {
  const state = ctx.control.status();
  const command = parseBotHaltCommand(text);
  // Bot đang chạy và câu không phải lệnh: không tốn truy vấn nào, để luồng thường đi tiếp
  if (!command && !state.halted) return PASS;

  const asker = await resolveAlertAsker(ctx.db, contact);
  // Người lạ: im lặng; đang tắt thì vẫn không xếp việc trả lời (không có gì gửi ra được)
  if (!asker) return { reply: null, consumed: state.halted };

  if (command === "halt") {
    // Không đủ quyền: bot đang chạy thì để luồng thường trả lời; đang tắt thì vẫn nuốt (không xếp việc trả lời nào)
    if (!canHaltBot(asker)) return { reply: null, consumed: state.halted };
    if (state.halted) return { reply: describeBotStatus(state), consumed: true };
    return { reply: haltedReply(await ctx.control.halt(asker.name, "zalo")), consumed: true };
  }
  if (command === "resume") {
    if (!state.halted) return { reply: describeBotStatus(state), consumed: true };
    if (!canResumeBot(asker)) return { reply: RESUME_DENIED_REPLY, consumed: true };
    await ctx.control.resume(asker.name, "zalo");
    return { reply: RESUMED_REPLY, consumed: true };
  }
  if (command === "status") return { reply: describeBotStatus(state), consumed: true };

  // Đang tắt + câu thường: một câu «tạm dừng» / người / lượt tắt
  if (state.since !== noticedForSince) {
    pauseNoticed.clear();
    noticedForSince = state.since ?? "";
  }
  if (pauseNoticed.has(asker.uid)) return { reply: null, consumed: true };
  pauseNoticed.add(asker.uid);
  return { reply: pausedReply(state), consumed: true };
}
