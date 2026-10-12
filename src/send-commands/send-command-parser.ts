import { foldKeepLength } from "../assistant/fold-text.js";
import { parseDueText } from "../tasks/task-due-parser.js";

// Đọc lệnh gửi tin gõ trên Zalo (phase 9). So khớp trên câu không dấu (`foldKeepLength`), cắt tên nơi nhận + nội dung từ
// câu GỐC (giữ hoa thường, xuống dòng). Không phải lệnh gửi thì null — chat-commands thử lệnh khác rồi tới trợ lý AI. Hàm thuần.
//   gửi nhóm Kho HN, anh Minh lúc 8h sáng mai: <nội dung>      (đầu và nội dung tách ở dấu «:» ĐẦU TIÊN)
//   hẹn giờ gửi nhóm A: …  ·  8h sáng mai gửi nhóm A: …  ·  gửi cái này vào nhóm A: …  (kèm tệp / ảnh vừa gửi bot)
//   lệnh gửi · /hengio · nhật ký gửi        hủy G-12 · hủy lệnh G-12 · /huy G-12        đồng ý G-12 · gửi G-12

export type SendChatCommand =
  | { kind: "send_draft"; targetNames: string[]; scheduleText: string; body: string; withRecentFiles: boolean }
  | { kind: "send_list" }
  | { kind: "send_cancel"; commandId: number }
  | { kind: "send_confirm"; commandId: number };

const MAX_INPUT = 6000;
const MAX_HEAD = 300;
/** Mã lệnh «G-12». Dạng đứng trần BẮT BUỘC có gạch nối («g3» trong câu thường không bị nuốt); «lệnh G12» thì gạch tùy ý. */
const STRICT_CODE = String.raw`#?g-(\d{1,9})`;
const LOOSE_CODE = String.raw`#?g-?(\d{1,9})`;

/** Động từ gửi đầu câu (có thể kèm «hẹn giờ» / «lên lịch» trước). */
const VERB_START = /^(?:(?:hen gio|hen|len lich)\s+)?(?:gui|nhan)\s+/;
/** Vật được gửi: «tin», hoặc «cái này / file này / ảnh này…» (kèm tệp vừa gửi bot). */
const OBJECT_WORDS = /^(tin nhan|tin|cai nay|file nay|tep nay|anh nay|hinh nay|may file nay|may anh nay|may tep nay)\s+/;
const PREPOSITION = /^(?:vao|cho|toi|den|sang)(?:\s+|$)/;
/** Cụm giờ hẹn đứng cuối danh sách: «lúc 8h sáng mai», «vào lúc 17h», «hẹn 8h». */
const SCHEDULE_MARK = /\s(?:vao luc|luc|hen gio|hen)\s+/g;
/** Ngày đứng ngay trước chữ «lúc»: «mai lúc 8h», «thứ 6 lúc 17h», «20/10 lúc 9h». */
const DAY_BEFORE = /\s(ngay mai|ngay kia|mai|hom nay|thu (?:hai|ba|tu|nam|sau|bay|[2-7])|t[2-7]|chu nhat|cn|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)$/;
const NAME_SEPARATOR = /\s*(?:[,;+]|\s(?:va|voi)\s)\s*/g;

/** Vị trí dấu «:» đầu tiên không nằm giữa hai chữ số («8:30» là giờ, không phải dấu tách). -1 nếu không có. */
function findHeadColon(raw: string): number {
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== ":") continue;
    if (/\d/.test(raw[index - 1] ?? "") && /\d/.test(raw[index + 1] ?? "")) continue;
    return index;
  }
  return -1;
}

/** Tách «danh sách nơi nhận [lúc <giờ>]» thành tên + chữ giờ (lấy cụm «lúc …» đầu tiên đọc được là giờ có giờ cụ thể). */
function splitNamesAndSchedule(raw: string, folded: string): { names: string; scheduleText: string } {
  for (const mark of folded.matchAll(SCHEDULE_MARK)) {
    const start = mark.index ?? 0;
    const timeText = raw.slice(start + mark[0].length).trim();
    const parsed = parseDueText(timeText, new Date());
    if (!parsed?.hasTime) continue;
    const before = folded.slice(0, start);
    const day = before.match(DAY_BEFORE);
    const dayText = day ? raw.slice(start - day[1].length, start).trim() : "";
    return { names: raw.slice(0, start - dayText.length).trim(), scheduleText: `${dayText} ${timeText}`.trim() };
  }
  return { names: raw.trim(), scheduleText: "" };
}

function splitNames(rawNames: string): string[] {
  const folded = foldKeepLength(rawNames.toLowerCase());
  const names: string[] = [];
  let from = 0;
  for (const separator of folded.matchAll(NAME_SEPARATOR)) {
    names.push(rawNames.slice(from, separator.index));
    from = (separator.index ?? 0) + separator[0].length;
  }
  names.push(rawNames.slice(from));
  return names.map((name) => name.trim().replace(/[.!?…]+$/u, "").trim()).filter(Boolean);
}

function parseDraft(raw: string): SendChatCommand | null {
  const colon = findHeadColon(raw);
  if (colon <= 0 || colon > MAX_HEAD) return null;
  const rawHead = raw.slice(0, colon).trim();
  const body = raw.slice(colon + 1).trim();
  const spaced = rawHead.replace(/\s+/g, " ");
  const head = foldKeepLength(spaced.toLowerCase());
  if (head.length !== spaced.length) return null;

  let leadSchedule = "";
  let offset = 0;
  const verb = head.match(VERB_START);
  if (verb) {
    offset = verb[0].length;
  } else {
    // Giờ đứng đầu: «8h sáng mai gửi nhóm A»
    const timeFirst = head.match(/^(.{2,40}?)\s(?:gui|nhan)\s+/);
    if (!timeFirst || !parseDueText(spaced.slice(0, timeFirst[1].length), new Date())?.hasTime) return null;
    leadSchedule = spaced.slice(0, timeFirst[1].length);
    offset = timeFirst[0].length;
  }
  let withRecentFiles = false;
  const object = head.slice(offset).match(OBJECT_WORDS);
  if (object) {
    withRecentFiles = !object[1].startsWith("tin");
    offset += object[0].length;
  }
  const preposition = head.slice(offset).match(PREPOSITION);
  if (preposition) offset += preposition[0].length;

  const { names, scheduleText } = splitNamesAndSchedule(spaced.slice(offset), head.slice(offset));
  const targetNames = splitNames(names);
  if (!targetNames.length) return null;
  if (!body && !withRecentFiles) return null;
  return { kind: "send_draft", targetNames, scheduleText: leadSchedule || scheduleText, body, withRecentFiles };
}

export function parseSendCommand(input: string): SendChatCommand | null {
  const raw = input.normalize("NFC").trim().replace(/^\/\s*/, "");
  if (!raw || raw.length > MAX_INPUT) return null;
  const folded = foldKeepLength(raw.toLowerCase());
  const whole = folded.replace(/\s+/g, " ").replace(/[.!?…]+$/u, "").trim();

  if (/^(lenh gui|lenh hen|lenh gui dang hen|lenh dang hen|nhat ky gui|hengio|nhatky)$/.test(whole)) return { kind: "send_list" };
  let match = whole.match(new RegExp(String.raw`^huy\s+lenh\s+${LOOSE_CODE}$`)) ?? whole.match(new RegExp(String.raw`^huy\s+${STRICT_CODE}$`));
  if (match) return { kind: "send_cancel", commandId: Number(match[1]) };
  match = whole.match(new RegExp(String.raw`^(?:dong y|ok|oke|xac nhan|gui)\s+(?:lenh\s+)?${STRICT_CODE}$`));
  if (match) return { kind: "send_confirm", commandId: Number(match[1]) };
  return parseDraft(raw);
}

/** Lệnh gửi (trong ChatCommand chung). */
export const isSendCommandKind = (kind: string | undefined): boolean => Boolean(kind?.startsWith("send_"));
