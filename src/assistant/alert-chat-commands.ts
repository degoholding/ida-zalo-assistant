import { parseKeywordList } from "../alerts/keyword-matcher.js";
import { ContactRole } from "../constants.js";
import type { AlertRuntime, AlertSettingsSnapshot } from "../data-access/alerts/alert-asker-facts.js";
import { ERROR_META_KEY } from "../mcp/mcp-meta-keys.js";
import { alertRuntimeFromDeps, dropPendingChanges, type AlertAsker, type AlertToolsDeps } from "./alert-tools.js";
import { alertPendingProviderLegacy, runAlertChatCommandLegacy } from "./alert-chat-commands-legacy.js";
import type { PendingStore, PendingStoreInput, PendingStoreProvider } from "./chat-confirm-router.js";
import type { ChatCommand, ChatCommandContext } from "./chat-commands.js";
import type { AskerAccess } from "./infra/asker-access.js";
import { resolveAssistantMcpBridge } from "./mcp-bridge/assistant-mcp-bridge-config.js";
import type { AssistantMcpTurn } from "./mcp-bridge/assistant-mcp-turn.js";
import type { CallToolResultLike } from "./mcp-bridge/mcp-call-result-mapper.js";
import { openMcpTurn } from "./mcp-bridge/open-mcp-turn.js";

// Lệnh gõ về CẢNH BÁO (cấu hình, cần xử lý, xong tin số, từ khóa, phút chờ, VIP) + kho «đề xuất đổi cấu hình» chờ «đồng ý» / «hủy», định tuyến theo họ `alerts`:
// họ BẬT (máy chủ MCP trong tiến trình liệt kê đủ công cụ lệnh) → gọi công cụ mặt `assistant_command` rồi dựng câu từ kết quả có cấu trúc; họ TẮT (hoặc thiếu
// móc `alertRuntime` ở ngữ cảnh) → đường cũ `alert-chat-commands-legacy.ts`. «xong tin số N» chạy NGAY; lệnh đổi cấu hình vẫn HAI BƯỚC: tạo nháp
// (`mcp_write_draft`, 15 phút) → «đồng ý» (công cụ `alert_config_confirm`). Câu trả lời giữ nguyên từng ký tự.

const CONFIRM_HINT = "Anh/chị nhắn «đồng ý» để lưu (trong 15 phút), «hủy» để bỏ.";
const TOOLS = {
  view: ["alert_config_view"], list: ["alert_pending_list"], handled: ["alert_item_mark_handled"], propose: ["alert_config_propose"],
  drafts: ["alert_config_pending", "alert_config_confirm", "alert_config_cancel"],
} as const;

interface CommandSession {
  turn: AssistantMcpTurn;
  /** Phiên do chính lệnh này mở (không có `ctx.mcp`) → phải đóng. */
  owned: boolean;
}

/** Phiên lệnh nếu họ `alerts` bật và máy chủ liệt kê đủ công cụ `needed`; không thì undefined (đường cũ). */
async function openSession(ctx: ChatCommandContext, deps: AlertToolsDeps, needed: readonly string[]): Promise<CommandSession | undefined> {
  let session: CommandSession | undefined;
  if (ctx.mcp) {
    const turn = await ctx.mcp();
    session = turn ? { turn, owned: false } : undefined;
  } else if (ctx.access) {
    // Không có phiên dựng sẵn (bài kiểm / `npm run test:mcp`): tự mở từ ngữ cảnh truy cập + móc cảnh báo của bot
    const access: AskerAccess & { alertRuntime: AlertRuntime } = { ...(await ctx.access()), saveSettings: deps.saveSettings, alertRuntime: alertRuntimeFromDeps(deps) };
    const turn = openMcpTurn(access, resolveAssistantMcpBridge(undefined), { wakeJobs: ctx.wakeJobs });
    session = turn ? { turn, owned: true } : undefined;
  }
  if (!session?.turn.familyEnabled("alerts")) return discard(session);
  const listed = await session.turn.command();
  return listed && needed.every((name) => listed.toolNames.has(name)) ? session : discard(session);
}

async function discard(session: CommandSession | undefined): Promise<undefined> {
  if (session?.owned) await session.turn.close();
  return undefined;
}

async function withSession<T>(ctx: ChatCommandContext, deps: AlertToolsDeps, needed: readonly string[], run: (turn: AssistantMcpTurn) => Promise<T>): Promise<{ value: T } | undefined> {
  const session = await openSession(ctx, deps, needed);
  if (!session) return undefined;
  try {
    return { value: await run(session.turn) };
  } finally {
    if (session.owned) await session.turn.close();
  }
}

type Called = { structured: Record<string, unknown> } | { failure: { code?: string; message: string } };

/** Gọi một công cụ lệnh; lỗi nghiệp vụ → `failure` (lớp lệnh dựng câu), lỗi hệ thống ném tiếp như đường cũ. */
async function call(turn: AssistantMcpTurn, name: string, args: Record<string, unknown>): Promise<Called> {
  const result: CallToolResultLike = await turn.callTool("assistant_command", name, args);
  if (result.isError || !result.structuredContent) {
    const meta = (result._meta as Record<string, unknown> | undefined)?.[ERROR_META_KEY] as { code?: string; message?: string } | undefined;
    if (!meta?.message || meta.code === "internal" || meta.code === "server_busy") throw new Error(`lệnh cảnh báo qua MCP lỗi (${name}): ${meta?.message ?? "không rõ"}`);
    return { failure: { code: meta.code, message: meta.message } };
  }
  return { structured: result.structuredContent as Record<string, unknown> };
}

// ---------------------------------------------------------------- dựng câu (chép nguyên chuỗi của bản cũ)

interface ConfigView {
  settings: AlertSettingsSnapshot;
  own: { all_groups: boolean; groups: string[]; vips: string[] } | null;
}

function configText(view: ConfigView): string {
  const { settings: alerts } = view;
  const list = (value: string) => parseKeywordList(value).join(", ") || "(trống)";
  const lines = [
    "CẤU HÌNH CẢNH BÁO",
    `- Cảnh báo: ${alerts.enabled ? "đang bật" : "đang TẮT"}; AI xét tin: ${alerts.aiEnabled ? "bật" : "tắt"}`,
    `- Từ KHẨN: ${list(alerts.urgentKeywords)}`,
    `- Từ QUAN TRỌNG: ${list(alerts.importantKeywords)}`,
    `- Từ cần AI xác nhận: ${list(alerts.strictKeywords)}`,
    `- Nhắc khi chưa ai trả lời sau ${alerts.replyWaitMinutes} phút làm việc (tin VIP: ${alerts.vipWaitMinutes} phút)`,
    `- Nhắc tối đa ${alerts.dailyReminderCap} lần / ngày; tin KHẨN gộp trong ${alerts.urgentMergeSeconds} giây rồi báo`,
    `- Giờ làm việc: ${alerts.workHours}; giờ yên lặng: ${alerts.quietHours} (chỉ báo KHẨN / VIP)`,
  ];
  if (view.own) {
    const names = (items: string[], max: number) => items.slice(0, max).join(", ") + (items.length > max ? ", …" : "");
    lines.push("", "CỦA RIÊNG ANH/CHỊ",
      `- Nhóm theo dõi: ${view.own.all_groups ? "tất cả các nhóm" : view.own.groups.length ? names(view.own.groups, 10) : "chưa gán nhóm nào"}`,
      `- VIP: ${view.own.vips.length ? names(view.own.vips, 30) : "chưa có"}`);
  }
  lines.push("", "Gõ «hướng dẫn» để xem các lệnh đổi cấu hình.");
  return lines.join("\n");
}

interface PendingResult {
  items: { message_id: number; muc: string; nhom: string; nguoi_gui: string; luc: string; tom_tat: string; qua_han: boolean }[];
  note?: string;
}

function pendingText(result: PendingResult): string {
  if (result.note) return result.note;
  if (!result.items.length) return "Hiện không có tin nào cần xử lý.";
  const lines = result.items.map((item) =>
    `#${item.message_id} ${item.muc === "KHẨN" ? "[KHẨN] " : ""}${item.nhom} — ${item.nguoi_gui}, ${item.luc}${item.qua_han ? " (QUÁ HẠN)" : ""}: ${item.tom_tat}`);
  return [`TIN CẦN XỬ LÝ (${result.items.length})`, ...lines, "", "Xử lý xong tin nào thì nhắn «xong <số>», vd «xong " + result.items[0].message_id + "»."].join("\n");
}

/**
 * Đổi cài đặt chung (từ khóa, phút chờ) chỉ Quản lý / Trưởng phòng. Lõi vẫn là nơi quyết định (kiểm lại từ chủ thể Zalo); kiểm sớm ở đây để câu từ chối
 * dựa trên người hỏi mà lớp lệnh đã phân giải — y hệt đường cũ — và khỏi tốn một lời gọi công cụ.
 */
const globalChangeDenied = (asker: AlertAsker, what: "từ khóa" | "thời gian chờ"): string | null =>
  asker.role === ContactRole.Manager || asker.role === ContactRole.DepartmentHead ? null : `Đổi ${what} áp dụng cho cả công ty — cần vai trò Quản lý / Trưởng phòng.`;

/** Một bước đề xuất: tạo nháp qua `alert_config_propose` → câu xem trước + nhắc xác nhận, hoặc câu báo lỗi. undefined = họ tắt (đường cũ). */
async function propose(ctx: ChatCommandContext, deps: AlertToolsDeps, args: Record<string, unknown>): Promise<string | undefined> {
  const ran = await withSession(ctx, deps, TOOLS.propose, (turn) => call(turn, "alert_config_propose", args));
  if (!ran) return undefined;
  if ("failure" in ran.value) return ran.value.failure.message;
  return `Em sẽ đổi: ${String(ran.value.structured.preview)}.\n${CONFIRM_HINT}`;
}

// ---------------------------------------------------------------- kho chờ «đồng ý» / «hủy»

interface OpenDraft {
  id: number;
  at: number;
}

/** Nháp đổi cấu hình mới nhất của người hỏi (qua `alert_config_pending`); null = họ tắt / không có. */
async function latestDraft(ctx: ChatCommandContext, deps: AlertToolsDeps): Promise<OpenDraft | null> {
  const ran = await withSession(ctx, deps, TOOLS.drafts, (turn) => call(turn, "alert_config_pending", {}));
  if (!ran || "failure" in ran.value) return null;
  const drafts = ran.value.structured.drafts as { id: number; created_at: string }[];
  return drafts[0] ? { id: drafts[0].id, at: new Date(drafts[0].created_at).getTime() } : null;
}

function draftStore(ctx: ChatCommandContext, deps: AlertToolsDeps, asker: AlertAsker, draft: OpenDraft): PendingStore {
  return {
    at: draft.at,
    async confirm() {
      const ran = await withSession(ctx, deps, TOOLS.drafts, (turn) => call(turn, "alert_config_confirm", { draft_id: draft.id }));
      if (!ran) return "Không có đề xuất này (hoặc đã quá 15 phút) — đề xuất lại.";
      return "failure" in ran.value ? ran.value.failure.message : String(ran.value.structured.message);
    },
    async cancel() {
      await withSession(ctx, deps, TOOLS.drafts, (turn) => call(turn, "alert_config_cancel", {}));
      dropPendingChanges(asker.uid);
      return "Dạ, em đã bỏ thay đổi, cấu hình giữ nguyên.";
    },
  };
}

/** Kho chờ xác nhận của đề xuất đổi cấu hình cảnh báo: nháp DB khi họ bật; kho RAM chỉ cho đường cũ (người dùng nào có cả hai thì cái mới nhất thắng). */
export const alertPendingProvider: PendingStoreProvider = {
  async latest(input: PendingStoreInput) {
    const { chat } = input;
    const { asker, alertTools: deps } = chat;
    if (!asker || !deps) return null;
    const legacy = await alertPendingProviderLegacy.latest(input);
    const draft = await latestDraft(chat, deps);
    return draft && (!legacy || draft.at >= legacy.at) ? draftStore(chat, deps, asker, draft) : legacy;
  },
};

/** Chạy lệnh cảnh báo (người hỏi đã có `asker` + `deps`). null = không phải lệnh cảnh báo. */
export async function runAlertChatCommand(ctx: ChatCommandContext, command: ChatCommand, asker: AlertAsker, deps: AlertToolsDeps): Promise<string | null> {
  const legacy = () => runAlertChatCommandLegacy(ctx, command, asker, deps);
  switch (command.kind) {
    case "show_config": {
      const ran = await withSession(ctx, deps, TOOLS.view, (turn) => call(turn, "alert_config_view", {}));
      if (!ran) return legacy();
      if ("failure" in ran.value) return ran.value.failure.message;
      return configText(ran.value.structured as unknown as ConfigView);
    }
    case "list_pending": {
      const ran = await withSession(ctx, deps, TOOLS.list, (turn) => call(turn, "alert_pending_list", { limit: 15 }));
      if (!ran) return legacy();
      if ("failure" in ran.value) return ran.value.failure.message;
      return pendingText(ran.value.structured as unknown as PendingResult);
    }
    case "mark_done": {
      const ran = await withSession(ctx, deps, TOOLS.handled, (turn) => call(turn, "alert_item_mark_handled", { message_id: command.messageId }));
      if (!ran) return legacy();
      return "failure" in ran.value ? `Không có tin #${command.messageId} trong danh sách của anh/chị — gõ «cần xử lý» để xem số tin.` : String(ran.value.structured.message);
    }
    case "keyword": {
      const action = `${command.add ? "add" : "remove"}_${command.level}_keyword`;
      if (!command.add) {
        const current = parseKeywordList(command.level === "urgent" ? deps.config.alerts.urgentKeywords : deps.config.alerts.importantKeywords);
        if (!current.includes(command.keyword)) return `Danh sách từ ${command.level === "urgent" ? "KHẨN" : "QUAN TRỌNG"} không có «${command.keyword}».`;
      }
      const denied = globalChangeDenied(asker, "từ khóa");
      if (denied) return denied;
      return (await propose(ctx, deps, { action, keyword: command.keyword })) ?? legacy();
    }
    case "wait_minutes": {
      const denied = globalChangeDenied(asker, "thời gian chờ");
      if (denied) return denied;
      return (await propose(ctx, deps, { action: command.vip ? "set_vip_wait_minutes" : "set_reply_wait_minutes", minutes: command.minutes })) ?? legacy();
    }
    case "vip": {
      if (!asker.recipientId) return "Anh/chị chưa là người nhận cảnh báo nên chưa có danh sách VIP — quản trị thêm ở màn Người nhận.";
      if (!command.name || command.name.length > 60) return "Nhắn «thêm vip <tên>», vd «thêm vip Đại lý Minh Phát».";
      return (await propose(ctx, deps, { action: command.add ? "add_vip" : "remove_vip", person_name: command.name })) ?? legacy();
    }
    default:
      return null;
  }
}
