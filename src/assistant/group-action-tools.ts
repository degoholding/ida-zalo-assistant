import type { FunctionDeclaration } from "./gemini-client.js";

// Công cụ HÀNH ĐỘNG trong nhóm (chốt 06/10/2026): tạo nhắc hẹn Zalo, ghim ghi chú lên nhóm, tạo bình chọn; xem / bỏ
// ghim ghi chú, xem / hủy nhắc hẹn. Chỉ có khi
// bot được gọi TRONG NHÓM, và chỉ tác động lên chính nhóm đó (nơi gọi đưa `GroupActions` đã gắn sẵn mã nhóm). Ai làm
// được = ai gọi được bot trong nhóm (người có vai trò / nhân sự — xem canCallBotInGroup). Zalo không có API ghim một tin có
// sẵn — «ghim» = tạo ghi chú có ghim. Nhắc hẹn là nhắc hẹn THẬT của Zalo: tới giờ chính Zalo báo, bot tắt vẫn nhắc.

export const MAX_ACTIONS_PER_TURN = 3;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const MAX_AHEAD_MS = 366 * 86_400_000;
const REPEAT_MODES: Record<string, 0 | 1 | 2 | 3> = { none: 0, daily: 1, weekly: 2, monthly: 3 };
const REPEAT_LABEL = ["không lặp", "hằng ngày", "hằng tuần", "hằng tháng"];

/** Việc làm trên Zalo, đã gắn sẵn nhóm đang hỏi — công cụ không chọn được nhóm khác. */
export interface GroupActions {
  createReminder(input: { title: string; startTime: number; repeat: 0 | 1 | 2 | 3 }): Promise<{ id: string }>;
  createPinnedNote(input: { title: string }): Promise<{ id: string }>;
  createPoll(input: { question: string; options: string[]; allowMultiChoices: boolean }): Promise<{ id: string }>;
  listNotes(): Promise<{ id: string; title: string; createdAt: number }[]>;
  /** Bỏ ghim một ghi chú của nhóm (giữ ghi chú, chỉ gỡ khỏi đầu nhóm). */
  unpinNote(id: string): Promise<void>;
  listReminders(): Promise<{ id: string; title: string; startTime: number; repeat: number }[]>;
  cancelReminder(id: string): Promise<void>;
}

export const GROUP_ACTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "create_reminder",
    description: "Tạo NHẮC HẸN của Zalo cho cả nhóm đang hỏi: tới giờ Zalo tự báo mọi thành viên. Thiếu giờ hoặc nội dung thì HỎI LẠI, không đoán.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Nội dung nhắc, ngắn gọn, vd 'Nộp báo cáo tiến độ tuần'" },
        start_time: { type: "string", description: "Thời điểm nhắc, ISO 8601 có +07:00, vd 2026-10-07T08:00:00+07:00" },
        repeat: { type: "string", enum: ["none", "daily", "weekly", "monthly"], description: "Lặp lại; mặc định none" },
      },
      required: ["title", "start_time"],
    },
  },
  {
    name: "create_pinned_note",
    description: "GHIM nội dung lên đầu nhóm đang hỏi (tạo ghi chú có ghim — Zalo không ghim được tin có sẵn). Dùng cho «ghim …», «lưu lên bảng tin nhóm».",
    parameters: {
      type: "object",
      properties: { content: { type: "string", description: "Nội dung ghi chú cần ghim (tự soạn gọn từ dữ liệu nhóm nếu người hỏi bảo ghim tóm tắt / báo cáo)" } },
      required: ["content"],
    },
  },
  {
    name: "list_pinned_notes",
    description: "Liệt kê ghi chú trên bảng tin nhóm đang hỏi (id, nội dung) — gọi trước khi bỏ ghim để biết id.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "unpin_note",
    description: "BỎ GHIM một ghi chú của nhóm đang hỏi (id lấy từ list_pinned_notes). Nhiều ghi chú mà người hỏi không nói rõ cái nào thì hỏi lại.",
    parameters: { type: "object", properties: { note_id: { type: "string" } }, required: ["note_id"] },
  },
  {
    name: "list_reminders",
    description: "Liệt kê nhắc hẹn của nhóm đang hỏi (id, nội dung, giờ, lặp) — gọi trước khi hủy nhắc hẹn.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "cancel_reminder",
    description: "HỦY một nhắc hẹn của nhóm đang hỏi (id lấy từ list_reminders). Không chắc cái nào thì hỏi lại.",
    parameters: { type: "object", properties: { reminder_id: { type: "string" } }, required: ["reminder_id"] },
  },
  {
    name: "create_poll",
    description: "Tạo BÌNH CHỌN trong nhóm đang hỏi.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "Câu hỏi bình chọn" },
        options: { type: "array", items: { type: "string" }, description: "2–10 lựa chọn" },
        allow_multiple: { type: "boolean", description: "Cho chọn nhiều đáp án; mặc định không" },
      },
      required: ["question", "options"],
    },
  },
];

export const GROUP_ACTION_TOOL_NAMES = new Set(GROUP_ACTION_DECLARATIONS.map((tool) => tool.name));

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (raw: unknown, max: number) => (typeof raw === "string" ? raw.trim().replace(/\s+\n/g, "\n").slice(0, max) : "");

/** «2026-10-07T08:00» không có múi giờ → hiểu là giờ Việt Nam (máy chủ có thể chạy UTC). */
export function parseVnTime(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const ms = Date.parse(hasZone ? value : `${value}+07:00`);
  return Number.isFinite(ms) ? ms : null;
}

export function formatVnTime(ms: number): string {
  const iso = new Date(ms + VN_OFFSET_MS).toISOString();
  return `${iso.slice(11, 16)} ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function parseReminderInput(args: Record<string, unknown>, now: Date): Parsed<{ title: string; startTime: number; repeat: 0 | 1 | 2 | 3 }> {
  const title = text(args.title, 200);
  if (!title) return { ok: false, error: "Thiếu nội dung nhắc — hỏi lại người dùng nhắc việc gì." };
  const startTime = parseVnTime(args.start_time);
  if (startTime === null) return { ok: false, error: "Thiếu hoặc sai giờ nhắc — hỏi lại người dùng nhắc lúc mấy giờ, ngày nào." };
  if (startTime < now.getTime() - 60_000) return { ok: false, error: `Giờ nhắc ${formatVnTime(startTime)} đã qua — hỏi lại giờ khác.` };
  if (startTime > now.getTime() + MAX_AHEAD_MS) return { ok: false, error: "Giờ nhắc xa quá một năm — hỏi lại." };
  const repeat = REPEAT_MODES[typeof args.repeat === "string" ? args.repeat : "none"] ?? 0;
  return { ok: true, value: { title, startTime, repeat } };
}

export function parseNoteInput(args: Record<string, unknown>): Parsed<{ title: string }> {
  const title = text(args.content, 2000);
  return title ? { ok: true, value: { title } } : { ok: false, error: "Thiếu nội dung cần ghim." };
}

export function parsePollInput(args: Record<string, unknown>): Parsed<{ question: string; options: string[]; allowMultiChoices: boolean }> {
  const question = text(args.question, 200);
  if (!question) return { ok: false, error: "Thiếu câu hỏi bình chọn." };
  const options = Array.isArray(args.options)
    ? [...new Set(args.options.map((option) => text(option, 100)).filter(Boolean))]
    : [];
  if (options.length < 2) return { ok: false, error: "Bình chọn cần ít nhất 2 lựa chọn — hỏi lại." };
  if (options.length > 10) return { ok: false, error: "Bình chọn tối đa 10 lựa chọn." };
  return { ok: true, value: { question, options, allowMultiChoices: args.allow_multiple === true } };
}

/** Chạy một công cụ hành động; `counter` đếm số việc đã làm trong lượt (trần MAX_ACTIONS_PER_TURN). */
export async function runGroupAction(
  actions: GroupActions | undefined,
  counter: { done: number },
  name: string,
  args: Record<string, unknown>,
  now: Date,
): Promise<Record<string, unknown>> {
  if (!actions) return { error: "Tạo nhắc hẹn / ghim / bình chọn chỉ làm được khi được gọi trong nhóm Zalo." };
  if (counter.done >= MAX_ACTIONS_PER_TURN) return { error: `Mỗi lần hỏi chỉ làm tối đa ${MAX_ACTIONS_PER_TURN} việc.` };
  if (name === "create_reminder") {
    const parsed = parseReminderInput(args, now);
    if (!parsed.ok) return { error: parsed.error };
    const { id } = await actions.createReminder(parsed.value);
    counter.done += 1;
    return { created: "nhắc hẹn", id, title: parsed.value.title, time_vn: formatVnTime(parsed.value.startTime), repeat: REPEAT_LABEL[parsed.value.repeat] };
  }
  if (name === "list_pinned_notes") {
    const notes = await actions.listNotes();
    return { notes: notes.map((note) => ({ id: note.id, content: note.title.slice(0, 300), created: formatVnTime(note.createdAt) })) };
  }
  if (name === "list_reminders") {
    const reminders = await actions.listReminders();
    return {
      reminders: reminders.map((item) => ({ id: item.id, title: item.title, time_vn: formatVnTime(item.startTime), repeat: REPEAT_LABEL[item.repeat] ?? "" })),
    };
  }
  if (name === "unpin_note" || name === "cancel_reminder") {
    const id = text(name === "unpin_note" ? args.note_id : args.reminder_id, 64);
    if (!id) return { error: `Thiếu id — gọi ${name === "unpin_note" ? "list_pinned_notes" : "list_reminders"} trước.` };
    // Chỉ id có thật trong nhóm này — mô hình bịa id hoặc lấy id nhóm khác thì từ chối
    const known = name === "unpin_note" ? await actions.listNotes() : await actions.listReminders();
    if (!known.some((item) => item.id === id)) return { error: "Không có mục này trong nhóm — gọi lại danh sách để lấy id đúng." };
    if (name === "unpin_note") await actions.unpinNote(id);
    else await actions.cancelReminder(id);
    counter.done += 1;
    // Bỏ ghim đi đường tự gọi (thư viện không hỗ trợ) — nói thật là đã gửi lệnh, nhờ người hỏi kiểm lại
    return name === "unpin_note"
      ? { done: "đã gửi lệnh bỏ ghim", id, note: "Nói với người hỏi: nếu ghi chú vẫn còn ghim ở đầu nhóm thì báo lại để kiểm tra." }
      : { done: "đã hủy nhắc hẹn", id };
  }
  if (name === "create_pinned_note") {
    const parsed = parseNoteInput(args);
    if (!parsed.ok) return { error: parsed.error };
    const { id } = await actions.createPinnedNote(parsed.value);
    counter.done += 1;
    return { created: "ghi chú đã ghim", id, where: "mục «Ghi chú, ghim» của nhóm" };
  }
  const parsed = parsePollInput(args);
  if (!parsed.ok) return { error: parsed.error };
  const { id } = await actions.createPoll(parsed.value);
  counter.done += 1;
  return { created: "bình chọn", id, question: parsed.value.question, options: parsed.value.options };
}
