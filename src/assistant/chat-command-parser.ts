import { parseBriefCommand } from "../briefs/brief-command-parser.js";
import { parseSendCommand } from "../send-commands/send-command-parser.js";
import { parseTaskCommand } from "../tasks/task-command-parser.js";
import type { TicketCommand } from "../tickets/ticket-commands.js";
import type { ChatCommand } from "./chat-commands.js";
import { foldKeepLength } from "./fold-text.js";
import { parseWriteCodeCommand } from "./write-confirm-chat.js";

// Đọc một tin thành lệnh gõ (hàm thuần, không đụng DB). Thứ tự thử quan trọng: ticket → việc → bản tin → gửi → «đồng ý <mã>» → lệnh ngắn.

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
  const briefCommand = parseBriefCommand(input);
  if (briefCommand) return briefCommand;
  // Lệnh gửi: SAU việc / ticket / bản tin («giao Minh: …» vẫn là việc), TRƯỚC lệnh cấu hình — câu dài, không chịu trần 120 ký tự
  const sendCommand = parseSendCommand(input);
  if (sendCommand) return sendCommand;
  // «đồng ý K7Q2MX» / «hủy K7Q2MX»: xác nhận một nháp ghi cụ thể khi có nhiều nháp đang mở
  const writeCode = parseWriteCodeCommand(input);
  if (writeCode) return writeCode;
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
  // Chỉ là lệnh khi đang có đề xuất / nháp chờ (xem runChatCommand) — nên nhận rộng cách gõ tắt: «okee», «okeee», «oki», «ừ»,
  // «được», «gửi đi», kèm đuôi «nhé / nha / em». Trước 12/10/2026 «okee» lọt sang AI (không có quyền xác nhận) → nháp hết hạn.
  if (/^(dong y|o+k+e*|oki+e?|okay|xac nhan|luu|yes|co|uh+|u+|um+|chot|duoc|dc|gui di|gui luon|lam di|tao di)( (nhe|nha|em|nhe em|nha em|luon|di))*$/.test(folded)) return { kind: "confirm" };
  if (/^(huy|thoi|khong|bo qua|cancel)( (nhe|nha|em|di))*$/.test(folded)) return { kind: "cancel" };
  return null;
}

