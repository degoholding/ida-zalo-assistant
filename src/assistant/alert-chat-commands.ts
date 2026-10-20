// mcp-guard: legacy(alerts) — cấu hình / tin cần xử lý / VIP đọc DB trực tiếp; phase 10 chuyển sang họ `alerts`
import type { RowDataPacket } from "mysql2";
import type { AppConfig } from "../config.js";
import { parseKeywordList } from "../alerts/keyword-matcher.js";
import { describeContactChoices, pickContactMatch, searchContactsByName } from "../sync/contact-search.js";
import { dropPendingChanges, latestPendingChange, runAlertTool, type AlertAsker, type AlertToolsDeps } from "./alert-tools.js";
import type { PendingStoreProvider } from "./chat-confirm-router.js";
import type { ChatCommand, ChatCommandContext } from "./chat-commands.js";

// Lệnh gõ về CẢNH BÁO (cấu hình, cần xử lý, xong tin số, từ khóa, phút chờ, VIP) + kho «đề xuất đổi cấu hình» chờ «đồng ý» / «hủy».
// Đổi cấu hình vẫn hai bước như công cụ AI: bot đọc lại thay đổi, người gõ «đồng ý» ở tin sau mới lưu (kho đề xuất ở alert-tools.ts).

const CONFIRM_HINT = "Anh/chị nhắn «đồng ý» để lưu (trong 15 phút), «hủy» để bỏ.";

async function buildConfigText(ctx: ChatCommandContext, config: AppConfig): Promise<string> {
  const { alerts, calendar } = config;
  const list = (value: string) => parseKeywordList(value).join(", ") || "(trống)";
  const lines = [
    "CẤU HÌNH CẢNH BÁO",
    `- Cảnh báo: ${alerts.enabled ? "đang bật" : "đang TẮT"}; AI xét tin: ${alerts.aiEnabled ? "bật" : "tắt"}`,
    `- Từ KHẨN: ${list(alerts.urgentKeywords)}`,
    `- Từ QUAN TRỌNG: ${list(alerts.importantKeywords)}`,
    `- Từ cần AI xác nhận: ${list(alerts.strictKeywords)}`,
    `- Nhắc khi chưa ai trả lời sau ${alerts.replyWaitMinutes} phút làm việc (tin VIP: ${alerts.vipWaitMinutes} phút)`,
    `- Nhắc tối đa ${alerts.dailyReminderCap} lần / ngày; tin KHẨN gộp trong ${alerts.urgentMergeSeconds} giây rồi báo`,
    `- Giờ làm việc: ${calendar.workHours}; giờ yên lặng: ${calendar.quietHours} (chỉ báo KHẨN / VIP)`,
  ];
  const recipientId = ctx.asker?.recipientId;
  if (recipientId) {
    const [rows] = await ctx.db.query<RowDataPacket[]>("SELECT all_groups FROM recipient WHERE id = ?", [recipientId]);
    const [groups] = await ctx.db.query<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(g.label, ''), g.name) AS name FROM recipient_group rg JOIN zalo_group g ON g.id = rg.group_id
       WHERE rg.recipient_id = ? ORDER BY name LIMIT 11`, [recipientId]);
    const [vips] = await ctx.db.query<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(c.display_name, ''), c.zalo_name) AS name FROM recipient_vip v JOIN contact c ON c.id = v.contact_id
       WHERE v.recipient_id = ? ORDER BY name LIMIT 31`, [recipientId]);
    const names = (items: RowDataPacket[], max: number) =>
      items.slice(0, max).map((row) => row.name).join(", ") + (items.length > max ? ", …" : "");
    lines.push("", "CỦA RIÊNG ANH/CHỊ",
      `- Nhóm theo dõi: ${rows[0]?.all_groups ? "tất cả các nhóm" : groups.length ? names(groups, 10) : "chưa gán nhóm nào"}`,
      `- VIP: ${vips.length ? names(vips, 30) : "chưa có"}`);
  }
  lines.push("", "Gõ «hướng dẫn» để xem các lệnh đổi cấu hình.");
  return lines.join("\n");
}

async function listPendingText(ctx: ChatCommandContext, deps: AlertToolsDeps, asker: AlertAsker): Promise<string> {
  const result = await runAlertTool(deps, asker, "list_pending_items", { limit: 15 }, ctx.now, Date.now(), await ctx.access?.()) as {
    items: { message_id: number; muc: string; nhom: string; nguoi_gui: string; luc: string; tom_tat: string; qua_han: boolean; trang_thai: string }[];
    note?: string;
  };
  if (result.note) return result.note;
  if (!result.items.length) return "Hiện không có tin nào cần xử lý.";
  const lines = result.items.map((item) =>
    `#${item.message_id} ${item.muc === "KHẨN" ? "[KHẨN] " : ""}${item.nhom} — ${item.nguoi_gui}, ${item.luc}${item.qua_han ? " (QUÁ HẠN)" : ""}: ${item.tom_tat}`);
  return [`TIN CẦN XỬ LÝ (${result.items.length})`, ...lines, "", "Xử lý xong tin nào thì nhắn «xong <số>», vd «xong " + result.items[0].message_id + "»."].join("\n");
}

async function findPersonForVip(ctx: ChatCommandContext, recipientId: number, name: string, add: boolean): Promise<{ uid: string } | { reply: string }> {
  const rows = await searchContactsByName(ctx.db, name, add ? {} : { vipOfRecipientId: recipientId });
  if (!rows.length) return { reply: add ? `Em không tìm thấy ai tên «${name}» trong Danh bạ.` : `Trong VIP của anh/chị không có ai tên «${name}».` };
  const picked = pickContactMatch(rows);
  if (picked) return { uid: picked.uid };
  return { reply: describeContactChoices(rows, name, `${add ? "thêm" : "bỏ"} vip <tên đầy đủ>`) };
}

/** Một bước đề xuất: trả câu xem trước + nhắc xác nhận, hoặc câu báo lỗi. */
async function propose(ctx: ChatCommandContext, deps: AlertToolsDeps, asker: AlertAsker, args: Record<string, unknown>): Promise<string> {
  const result = await runAlertTool(deps, asker, "propose_alert_change", args, ctx.now, Date.now());
  if (typeof result.error === "string") return result.error;
  return `Em sẽ đổi: ${String(result.preview)}.\n${CONFIRM_HINT}`;
}

/** Kho chờ xác nhận của đề xuất đổi cấu hình cảnh báo (trong bộ nhớ, theo người hỏi). */
export const alertPendingProvider: PendingStoreProvider = {
  async latest({ chat }) {
    const { asker, alertTools: deps } = chat;
    const change = asker && deps ? latestPendingChange(asker.uid) : null;
    if (!asker || !deps || !change) return null;
    return {
      at: change.createdAt,
      async confirm() {
        const result = await runAlertTool(deps, asker, "confirm_alert_change", { change_id: change.id }, chat.now, Date.now());
        return typeof result.error === "string" ? result.error : String(result.message);
      },
      async cancel() {
        dropPendingChanges(asker.uid);
        return "Dạ, em đã bỏ thay đổi, cấu hình giữ nguyên.";
      },
    };
  },
};

/** Chạy lệnh cảnh báo (người hỏi đã có `asker` + `deps`). null = không phải lệnh cảnh báo. */
export async function runAlertChatCommand(ctx: ChatCommandContext, command: ChatCommand, asker: AlertAsker, deps: AlertToolsDeps): Promise<string | null> {
  switch (command.kind) {
    case "show_config":
      return buildConfigText(ctx, deps.config);
    case "list_pending":
      return listPendingText(ctx, deps, asker);
    case "mark_done": {
      const result = await runAlertTool(deps, asker, "mark_item_handled", { message_id: command.messageId }, ctx.now, Date.now(), await ctx.access?.());
      return typeof result.error === "string" ? `Không có tin #${command.messageId} trong danh sách của anh/chị — gõ «cần xử lý» để xem số tin.` : String(result.message);
    }
    case "keyword": {
      const action = `${command.add ? "add" : "remove"}_${command.level}_keyword`;
      if (!command.add) {
        const current = parseKeywordList(command.level === "urgent" ? deps.config.alerts.urgentKeywords : deps.config.alerts.importantKeywords);
        if (!current.includes(command.keyword)) return `Danh sách từ ${command.level === "urgent" ? "KHẨN" : "QUAN TRỌNG"} không có «${command.keyword}».`;
      }
      return propose(ctx, deps, asker, { action, keyword: command.keyword });
    }
    case "wait_minutes":
      return propose(ctx, deps, asker, { action: command.vip ? "set_vip_wait_minutes" : "set_reply_wait_minutes", minutes: command.minutes });
    case "vip": {
      if (!asker.recipientId) return "Anh/chị chưa là người nhận cảnh báo nên chưa có danh sách VIP — quản trị thêm ở màn Người nhận.";
      if (!command.name || command.name.length > 60) return "Nhắn «thêm vip <tên>», vd «thêm vip Đại lý Minh Phát».";
      const person = await findPersonForVip(ctx, asker.recipientId, command.name, command.add);
      if ("reply" in person) return person.reply;
      return propose(ctx, deps, asker, { action: command.add ? "add_vip" : "remove_vip", person_uid: person.uid });
    }
    default:
      return null;
  }
}
