import type { RowDataPacket } from "mysql2";
import type { AppConfig } from "../config.js";
import { ContactRole } from "../constants.js";
import type { Db } from "../db/pool.js";
import { parseKeywordList } from "../alerts/keyword-matcher.js";
import { dropPendingChanges, latestPendingChange, runAlertTool, type AlertAsker, type AlertToolsDeps } from "./alert-tools.js";
import { runTicketCommand, type TicketCommand, type TicketCommandContext } from "../tickets/ticket-commands.js";
import { describeContactChoices, pickContactMatch, searchContactsByName } from "../sync/contact-search.js";
import { foldKeepLength } from "./fold-text.js";
import { isTaskCommandKind, parseTaskCommand, type TaskCommand } from "../tasks/task-command-parser.js";
import { runTaskCommand, type TaskCommandContext } from "../tasks/task-commands.js";

// Lệnh gõ sẵn trong chat với bot (đại ca 08/10/2026: gõ «hướng dẫn» ra hướng dẫn cơ bản, có lệnh cấu hình luôn). Chạy TRƯỚC mô
// hình: trả lời ngay, không tốn token, không phụ thuộc AI hiểu đúng. Gõ có dấu hay không dấu đều nhận. Câu không khớp lệnh nào
// thì đi tiếp vào trợ lý AI như cũ. Đổi cấu hình vẫn hai bước như công cụ AI: bot đọc lại thay đổi, người gõ «đồng ý» ở tin
// sau mới lưu — dùng chung kho đề xuất của src/assistant/alert-tools.ts.

export type ChatCommand =
  | { kind: "help" }
  | { kind: "show_config" }
  | { kind: "list_pending" }
  | { kind: "mark_done"; messageId: number }
  | { kind: "keyword"; add: boolean; level: "urgent" | "important"; keyword: string }
  | { kind: "wait_minutes"; vip: boolean; minutes: number }
  | { kind: "vip"; add: boolean; name: string }
  | { kind: "confirm" }
  | { kind: "cancel" }
  | TicketCommand
  | TaskCommand;

/** Lệnh ticket (báo / xem / nhận / xong / hủy / bổ sung) — người chưa có vai trò cũng dùng được (src/tickets/). */
export const isTicketCommand = (command: ChatCommand | null): command is TicketCommand => Boolean(command?.kind.startsWith("ticket_"));

/** Lệnh việc (phase 7: «việc», «xong V-12», «giao Minh: …») — người phụ trách chưa có vai trò cũng dùng được (quyền kiểm theo việc). */
export const isTaskCommand = (command: ChatCommand | null): command is TaskCommand => isTaskCommandKind(command?.kind);

const TICKET_TEXT_MAX = 3000;

/**
 * Lệnh ticket có nội dung dài (lời báo, ghi chú): đọc trên câu GỐC (giữ xuống dòng, dấu câu), chỉ so tiền tố không dấu.
 * «báo lỗi: …», «ticket: …», «T-12: …», «xong T-12 …», «hủy T-12 …».
 */
function parseTicketTextCommand(input: string): TicketCommand | null {
  const raw = input.normalize("NFC").trim();
  if (!raw || raw.length > TICKET_TEXT_MAX + 40) return null;
  const folded = foldKeepLength(raw.toLowerCase());
  const rest = (match: RegExpMatchArray) => raw.slice(match[0].length).trim();
  let match = folded.match(/^(bao loi|bao su co|bao ticket|tao ticket|yeu cau ho tro|ticket)\s*[:\-–]\s*/)
    ?? folded.match(/^(bao loi|bao su co|bao ticket|tao ticket)\s+/);
  if (match) {
    const text = rest(match);
    return text.length >= 3 ? { kind: "ticket_create", text } : null;
  }
  // «xong T-12», «báo xử lý xong T1», «đã xử lý xong T-12 …», «báo hủy T12»
  match = folded.match(/^(?:bao\s+)?(?:da\s+)?(?:xu\s+ly\s+)?(xong|huy)\s+(ticket\s+)?#?t\s?-?(\d{1,6})(\s*[:\-–]\s*|\s+|$)/);
  if (match) return { kind: match[1] === "xong" ? "ticket_done" : "ticket_cancel", ticketId: Number(match[3]), note: rest(match) };
  match = folded.match(/^#?t\s?-?(\d{1,6})\s*[:\-–]\s*/);
  if (match) {
    const note = rest(match);
    return note ? { kind: "ticket_note", ticketId: Number(match[1]), note } : null;
  }
  return null;
}

/** Đọc một tin thành lệnh; không phải lệnh thì null. */
export function parseChatCommand(input: string): ChatCommand | null {
  const ticketText = parseTicketTextCommand(input);
  if (ticketText) return ticketText;
  const taskCommand = parseTaskCommand(input);
  if (taskCommand) return taskCommand;
  const original = input.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?…]+$/u, "").trim();
  if (!original || original.length > 120) return null;
  const folded = foldKeepLength(original);
  const tail = (match: RegExpMatchArray) => original.slice(match[0].length - match[match.length - 1].length).trim().replace(/^["«“']+|["»”']+$/gu, "").trim();

  if (/^\/?(huong dan( su dung| dung bot| dung)?( (cho )?(toi|em|anh|chi|minh|tui))?|help|tro giup|menu|lenh|danh sach lenh|cac lenh)$/.test(folded)) return { kind: "help" };
  if (/^\/?(xem )?(cau hinh|cai dat)( canh bao)?$/.test(folded)) return { kind: "show_config" };
  if (/^\/?(co gi )?(can xu ly|tin can xu ly|viec can xu ly)$/.test(folded)) return { kind: "list_pending" };
  let match = folded.match(/^xong (tin )?(so )?#?(\d{1,12})$/);
  if (match) return { kind: "mark_done", messageId: Number(match[3]) };
  match = folded.match(/^(them|bo|xoa) tu (khoa )?(khan|quan trong) (.+)$/);
  if (match) return { kind: "keyword", add: match[1] === "them", level: match[3] === "khan" ? "urgent" : "important", keyword: tail(match) };
  match = folded.match(/^(phut cho|thoi gian cho) (vip )?(\d{1,4})( phut)?$/);
  if (match) return { kind: "wait_minutes", vip: Boolean(match[2]), minutes: Number(match[3]) };
  match = folded.match(/^(them|bo|xoa) vip (.+)$/);
  if (match) return { kind: "vip", add: match[1] === "them", name: tail(match) };
  if (/^(ticket|tickets|ds ticket|danh sach ticket|ticket cua (toi|em|anh|chi|minh|tui))$/.test(folded)) return { kind: "ticket_list" };
  // «hiện tại có bao nhiêu ticket», «có mấy ticket đang mở», «ticket nào chưa xử lý»
  if (/^(hien tai |hien gio |bay gio )?(co )?(bao nhieu|may|nhung) ticket( (dang mo|chua xu ly|dang cho|roi))?$/.test(folded)
    || /^(cac )?ticket (nao )?(dang mo|chua xu ly|dang cho)$/.test(folded)) return { kind: "ticket_list" };
  // «nhận T-12», «đã nhận xử lý T12»
  match = folded.match(/^(da )?nhan( xu ly)? (ticket )?#?t ?-?(\d{1,6})$/);
  if (match) return { kind: "ticket_accept", ticketId: Number(match[4]) };
  // «T1 xong rồi», «T-12 đã xử lý xong»
  match = folded.match(/^#?t ?-?(\d{1,6}) (da )?(xu ly )?xong( roi)?$/);
  if (match) return { kind: "ticket_done", ticketId: Number(match[1]), note: "" };
  match = folded.match(/^(xem )?(ticket )?#?t ?-?(\d{1,6})( (sao roi|the nao|xong chua|tinh hinh|den dau roi|sao))?$/);
  if (match) return { kind: "ticket_status", ticketId: Number(match[3]) };
  if (/^(dong y|ok|oke|okay|xac nhan|luu|yes|co|uh|u|chot)$/.test(folded)) return { kind: "confirm" };
  if (/^(huy|thoi|khong|bo qua|cancel)$/.test(folded)) return { kind: "cancel" };
  return null;
}

export interface ChatCommandContext {
  db: Db;
  /** Có = dịch vụ thật (cấu hình đọc từ alertTools.config); không có = chỉ còn «hướng dẫn» */
  alertTools?: AlertToolsDeps;
  /** null = người hỏi không có vai trò / không là người nhận */
  asker: AlertAsker | null;
  /** Hỏi trong nhóm (bot được gọi tên): chỉ có «hướng dẫn» và lệnh ticket, mọi lệnh khác để AI xử lý */
  inGroup: boolean;
  now: Date;
  /** Ticket: người hỏi + cuộc đang hỏi. Không có = không có lệnh ticket. */
  ticket?: TicketCommandContext;
  /** Việc (checklist): người hỏi + cuộc đang hỏi. Không có = không có lệnh việc. */
  task?: TaskCommandContext;
  /** Người chỉ được dùng lệnh ticket (chưa có vai trò, không là người nhận) — «hướng dẫn» chỉ nói phần ticket */
  ticketOnly?: boolean;
}

const CONFIRM_HINT = "Anh/chị nhắn «đồng ý» để lưu (trong 15 phút), «hủy» để bỏ.";
const canChangeGlobal = (asker: AlertAsker | null) => asker?.role === ContactRole.Manager || asker?.role === ContactRole.DepartmentHead;

const TICKET_HELP = [
  "BÁO TICKET (việc cần hỗ trợ, lỗi, sự cố):",
  "- báo lỗi: <nội dung> — có ảnh thì gửi ảnh TRƯỚC rồi nhắn",
  "- ticket — xem các ticket của anh/chị",
  "- T-12 — xem tình hình ticket T-12",
  "- T-12: <bổ sung> — thêm nội dung / ảnh cho ticket",
  "- xong T-12 — tự báo đã ổn (đóng ticket); hủy T-12 — hủy ticket báo nhầm",
];

const TASK_HELP = [
  "VIỆC (checklist, bot nhắc theo hạn):",
  "- việc — việc anh/chị đang phụ trách / đã giao; việc quá hạn",
  "- giao Minh: <việc> hạn <thứ 6 / 20/10 / mai 17h> — giao việc (trong nhóm thì bot tag người đó)",
  "- xong V-12 <ghi chú> — báo đã xong (bot báo người giao)",
  "- dời V-12 <hạn> · giao lại V-12 <tên> · hủy V-12 · V-12: <ghi chú> · V-12 — xem",
];

/** Người chỉ dùng được lệnh ticket / việc được giao (chưa có vai trò): chỉ lệnh của người phụ trách */
const TASK_ASSIGNEE_HELP = [
  "VIỆC ĐƯỢC GIAO:",
  "- việc — các việc anh/chị đang phụ trách",
  "- xong V-12 <ghi chú> — báo đã xong · V-12: <ghi chú> — nhắn người giao",
];

const TICKET_HANDLER_HELP = [
  "XỬ LÝ TICKET (người xử lý):",
  "- ticket — các ticket đang mở",
  "- nhận T-12 — nhận xử lý (bot báo người gửi)",
  "- xong T-12 <ghi chú> — báo đã xong",
  "- T-12: <nội dung> — nhắn người gửi",
];

export function buildHelpText(asker: AlertAsker | null, inGroup: boolean, options: { ticketOnly?: boolean; ticketHandler?: boolean } = {}): string {
  const ticketLines = ["", ...TASK_HELP, "", ...TICKET_HELP, ...(options.ticketHandler ? ["", ...TICKET_HANDLER_HELP] : [])];
  if (options.ticketOnly) return ["HƯỚNG DẪN DÙNG BOT TRỢ LÝ", ...TASK_ASSIGNEE_HELP, "", ...TICKET_HELP, ...(options.ticketHandler ? ["", ...TICKET_HANDLER_HELP] : [])].join("\n");
  if (inGroup) {
    return [
      "HƯỚNG DẪN DÙNG BOT TRONG NHÓM",
      "Gọi tên bot rồi nói việc cần làm, ví dụ:",
      "- Tóm tắt nhóm hôm nay / tuần này",
      "- Đọc file này / đọc link này giúp anh",
      "- Xuất PDF tóm tắt / xuất Excel báo cáo tuần",
      "- Nhắc cả nhóm 8h30 sáng mai họp giao ban",
      "- Ghim nội dung … / tạo bình chọn …",
      "- Tạo cuộc họp Meet 9h sáng mai",
      "Muốn xem tin cần xử lý hay đổi cấu hình cảnh báo thì nhắn RIÊNG cho bot.",
      "",
      "BÁO TICKET: gọi tên bot rồi «báo lỗi: <nội dung>» (có ảnh thì gửi ảnh trước).",
      "VIỆC: gọi tên bot rồi «giao Minh: <việc> hạn thứ 6», «việc nhóm», «xong V-12».",
    ].join("\n");
  }
  const lines = [
    "HƯỚNG DẪN DÙNG BOT TRỢ LÝ",
    "Hỏi bằng câu bình thường, ví dụ:",
    "- Tóm tắt nhóm Bán hàng hôm nay",
    "- Hôm qua anh Nam trao đổi gì",
    "- Tìm file báo giá tháng 9 / đọc file này",
    "- Xuất Excel báo cáo các nhóm tuần này",
    "- Đọc link này giúp anh <dán link>",
    "- Tạo cuộc họp Meet 9h sáng mai với …",
  ];
  if (asker) {
    lines.push("", "CẢNH BÁO TIN NHẮN (gõ đúng lệnh, có dấu hay không dấu đều được):",
      "- cần xử lý — tin KHẨN và tin đang chờ trả lời",
      "- xong 1234 — đánh dấu tin số 1234 đã xử lý (số lấy từ danh sách trên)",
      "- cấu hình — xem cấu hình cảnh báo đang dùng");
    if (asker.recipientId) lines.push("- thêm vip <tên> / bỏ vip <tên> — VIP của riêng anh/chị");
    if (canChangeGlobal(asker)) {
      lines.push("", "ĐỔI CẤU HÌNH CHUNG (quản lý / trưởng phòng):",
        "- thêm từ khẩn <từ> / bỏ từ khẩn <từ>",
        "- thêm từ quan trọng <từ> / bỏ từ quan trọng <từ>",
        "- phút chờ 120 — chưa ai trả lời sau 120 phút làm việc thì nhắc",
        "- phút chờ vip 30 — như trên cho tin của VIP");
    }
    lines.push("", "Lệnh đổi cấu hình: em đọc lại thay đổi, anh/chị nhắn «đồng ý» mới lưu, «hủy» để bỏ.");
  }
  lines.push(...ticketLines);
  return lines.join("\n");
}

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
  const result = await runAlertTool(deps, asker, "list_pending_items", { limit: 15 }, ctx.now, Date.now()) as {
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

/** Chạy lệnh. null = không xử lý ở đây (để trợ lý AI trả lời). */
export async function runChatCommand(ctx: ChatCommandContext, command: ChatCommand): Promise<string | null> {
  if (command.kind === "help") {
    const ticketHandler = ctx.ticket ? await ctx.ticket.isHandler() : false;
    return buildHelpText(ctx.inGroup ? null : ctx.asker, ctx.inGroup, { ticketOnly: ctx.ticketOnly, ticketHandler });
  }
  if (isTicketCommand(command)) return ctx.ticket ? runTicketCommand(ctx.ticket, command, ctx.now) : null;
  if (isTaskCommand(command)) return ctx.task ? runTaskCommand(ctx.task, command, ctx.now) : null;
  if (ctx.inGroup || ctx.ticketOnly) return null;
  const { asker, alertTools: deps } = ctx;
  if (command.kind === "confirm" || command.kind === "cancel") {
    // «ok», «không»… chỉ là lệnh khi người này ĐANG có đề xuất chờ; ngược lại là câu nói thường — để AI trả lời
    const change = asker ? latestPendingChange(asker.uid) : null;
    if (!asker || !deps || !change) return null;
    if (command.kind === "cancel") {
      dropPendingChanges(asker.uid);
      return "Dạ, em đã bỏ thay đổi, cấu hình giữ nguyên.";
    }
    const result = await runAlertTool(deps, asker, "confirm_alert_change", { change_id: change.id }, ctx.now, Date.now());
    return typeof result.error === "string" ? result.error : String(result.message);
  }
  if (!asker || !deps) {
    return command.kind === "show_config" ? null : "Lệnh này dành cho quản lý / trưởng phòng / người nhận cảnh báo. Gõ «hướng dẫn» để xem bot làm được gì.";
  }
  switch (command.kind) {
    case "show_config":
      return buildConfigText(ctx, deps.config);
    case "list_pending":
      return listPendingText(ctx, deps, asker);
    case "mark_done": {
      const result = await runAlertTool(deps, asker, "mark_item_handled", { message_id: command.messageId }, ctx.now, Date.now());
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
