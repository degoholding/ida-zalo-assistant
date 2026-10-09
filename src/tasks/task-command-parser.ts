import { foldKeepLength } from "../assistant/fold-text.js";
import type { TaskPriority, TaskSource } from "../constants.js";

// Đọc lệnh việc gõ trên Zalo (phase 7). So khớp trên câu không dấu, cắt nội dung / ghi chú / hạn từ câu GỐC. Không phải
// lệnh việc thì null — chat-commands.ts thử lệnh khác, rồi tới trợ lý AI. Hàm thuần.
//   việc · việc nhóm · việc quá hạn · việc chờ xác nhận
//   giao Minh: <việc> [hạn <…>] · giao việc cho anh Minh: … · giao @Minh: …
//   V-12 · V-12: <ghi chú> · xong V-12 [ghi chú] · V-12 xong rồi · dời V-12 <hạn> · giao lại V-12 <tên>
//   hủy V-12 [lý do] · mở lại V-12 · ok V-12 / bỏ V-12 (đề xuất)
//   Gõ kiểu lệnh của đặc tả IDA cũng được: /viec, /xong V-12, /doihan V-12 05/10, /giao Minh: …

export type TaskListScope = "mine" | "group" | "overdue" | "proposed";

export type TaskCommand =
  | { kind: "task_list"; scope: TaskListScope }
  | { kind: "task_create"; assigneeName: string; title: string; dueText: string; priority?: TaskPriority; source?: TaskSource }
  | { kind: "task_status"; taskId: number }
  | { kind: "task_done"; taskId: number; note: string }
  | { kind: "task_reschedule"; taskId: number; dueText: string }
  | { kind: "task_reassign"; taskId: number; assigneeName: string }
  | { kind: "task_cancel"; taskId: number; note: string }
  | { kind: "task_confirm"; taskId: number }
  | { kind: "task_reject"; taskId: number }
  | { kind: "task_reopen"; taskId: number; note: string }
  | { kind: "task_note"; taskId: number; note: string };

const MAX_INPUT = 1500;
// Mã việc: «V-12», «V12», «v-0012». Dạng đứng trần (xem / ok / bỏ) BẮT BUỘC có gạch nối — «v3», «ok v2» trong câu thường
// không bị nuốt thành lệnh (review 09/10/2026); dạng có động từ (xong / dời / hủy…) thì gạch nối tùy ý.
const ID = String.raw`#?v-?(\d{1,6})`;
const STRICT_ID = String.raw`#?v-(\d{1,6})`;
/** Từ đầu «giao …:» không phải tên người («Giao Hàng Nhanh: …», «giao hóa đơn: …») */
const NOT_A_PERSON = /^(hang|hoa don|don|xe|kho|bao gia|chung tu|tien|cong no)(\s|$)/;
/** «xong V-12 rồi nhé» — đuôi câu không phải ghi chú */
const FILLER_NOTE = /^(roi|nhe|nha|nhen|a|day|nhe a|roi nhe|roi nha|roi a|roi day|nha a)[\s.!]*$/;
/** Sau mã việc: hết câu, hoặc dấu «:» / «-» / khoảng trắng rồi tới ghi chú */
const TAIL = String.raw`(?:\s*[:\-–]\s*|\s+|$)`;

/** «giao Minh: gửi báo giá đại lý XT hạn thứ 6» → nội dung + hạn (chữ «hạn» / «deadline» cuối cùng tách hạn). */
function splitTitleAndDue(raw: string): { title: string; dueText: string } {
  const folded = foldKeepLength(raw.toLowerCase());
  const matches = [...folded.matchAll(/(?:^|[\s,;(])(han|deadline)\s*[:\-–]?\s+/g)];
  const last = matches.at(-1);
  if (!last || last.index === undefined) return { title: raw.trim(), dueText: "" };
  const title = raw.slice(0, last.index).replace(/[\s,;(]+$/, "").trim();
  const dueText = raw.slice(last.index + last[0].length).replace(/\)\s*$/, "").trim();
  return title ? { title, dueText } : { title: raw.trim(), dueText: "" };
}

export function parseTaskCommand(input: string): TaskCommand | null {
  // «/xong V-12», «/doihan V-12 05/10», «/viec» — đúng cách gõ trong tiêu chí nghiệm thu N5 của IDA: bỏ «/» đầu câu
  const raw = input.normalize("NFC").trim().replace(/^\/\s*/, "");
  if (!raw || raw.length > MAX_INPUT) return null;
  const folded = foldKeepLength(raw.toLowerCase());
  const rest = (match: RegExpMatchArray) => raw.slice((match.index ?? 0) + match[0].length).trim();
  const id = (value: string) => Number(value);

  // Danh sách — so cả câu (bỏ dấu câu cuối)
  const whole = folded.replace(/\s+/g, " ").replace(/[.!?…]+$/u, "").trim();
  if (/^\/?(viec|cac viec|ds viec|danh sach viec|checklist|viec cua (toi|em|anh|chi|minh|tui)|viec (dang lam|chua xong))$/.test(whole)) return { kind: "task_list", scope: "mine" };
  if (/^\/?viec (nhom|cua nhom|ca nhom|nhom nay)$/.test(whole)) return { kind: "task_list", scope: "group" };
  if (/^\/?(viec|cac viec) (qua han|tre han|tre)$/.test(whole)) return { kind: "task_list", scope: "overdue" };
  if (/^\/?(viec|cac viec) (cho xac nhan|de xuat|cho duyet)$/.test(whole)) return { kind: "task_list", scope: "proposed" };

  let match = folded.match(new RegExp(String.raw`^giao lai\s+(?:viec\s+)?${ID}\s+(?:cho\s+)?`));
  if (match) {
    const assigneeName = rest(match);
    return assigneeName ? { kind: "task_reassign", taskId: id(match[1]), assigneeName } : null;
  }
  // «giao việc cho Minh: …», «giao cho Minh: …», «giao @Minh: …», «giao Minh: …» (tên viết hoa — tránh «giao hàng: …»)
  match = folded.match(/^\/?giao\s+(viec\s+)?(cho\s+)?(@?[^:\n]{1,40}?)\s*:\s*(?=\S)/d);
  if (match?.indices?.[3]) {
    const [nameStart, nameEnd] = match.indices[3];
    const assigneeName = raw.slice(nameStart, nameEnd).trim();
    const explicit = Boolean(match[1] || match[2] || assigneeName.startsWith("@"));
    if (explicit || (/^\p{Lu}/u.test(assigneeName) && !NOT_A_PERSON.test(match[3]))) {
      const { title, dueText } = splitTitleAndDue(rest(match));
      return title.length >= 3 ? { kind: "task_create", assigneeName, title, dueText } : null;
    }
  }
  match = folded.match(new RegExp(String.raw`^(?:bao\s+)?(?:da\s+)?(?:xong|hoan thanh)\s+(?:viec\s+)?${ID}${TAIL}`));
  if (match) {
    const note = rest(match);
    return { kind: "task_done", taskId: id(match[1]), note: FILLER_NOTE.test(foldKeepLength(note.toLowerCase())) ? "" : note };
  }
  match = folded.match(new RegExp(String.raw`^${ID}\s+(?:da\s+)?(?:xong|hoan thanh)(?:\s+roi)?\s*[.!]*$`));
  if (match) return { kind: "task_done", taskId: id(match[1]), note: "" };
  match = folded.match(new RegExp(String.raw`^(?:doi han|doihan|doi|gia han|giahan|lui han|dat han)\s+(?:viec\s+)?${ID}\s+(?:sang\s+|den\s+|toi\s+|thanh\s+|la\s+|:\s*)?`));
  if (match) {
    const dueText = rest(match);
    return dueText ? { kind: "task_reschedule", taskId: id(match[1]), dueText } : null;
  }
  match = folded.match(new RegExp(String.raw`^huy\s+(?:viec\s+)?${ID}${TAIL}`));
  if (match) return { kind: "task_cancel", taskId: id(match[1]), note: rest(match) };
  match = folded.match(new RegExp(String.raw`^mo lai\s+(?:viec\s+)?${ID}${TAIL}`));
  if (match) return { kind: "task_reopen", taskId: id(match[1]), note: rest(match) };
  match = whole.match(new RegExp(String.raw`^(?:ok|oke|okay|dong y|xac nhan|luu|chot|duyet)\s+(?:viec\s+)?${STRICT_ID}$`));
  if (match) return { kind: "task_confirm", taskId: id(match[1]) };
  match = whole.match(new RegExp(String.raw`^(?:bo|khong phai|sai|khong|loai)\s+(?:viec\s+)?${STRICT_ID}$`));
  if (match) return { kind: "task_reject", taskId: id(match[1]) };
  match = folded.match(new RegExp(String.raw`^${STRICT_ID}\s*[:\-–]\s*`));
  if (match) {
    const note = rest(match);
    return note ? { kind: "task_note", taskId: id(match[1]), note } : null;
  }
  match = whole.match(new RegExp(String.raw`^(?:xem\s+)?(?:viec\s+)?${STRICT_ID}(?:\s+(?:sao roi|the nao|xong chua|tinh hinh|den dau roi|sao))?$`));
  if (match) return { kind: "task_status", taskId: id(match[1]) };
  return null;
}

/** Lệnh việc (trong ChatCommand chung). */
export const isTaskCommandKind = (kind: string | undefined): boolean => Boolean(kind?.startsWith("task_"));
