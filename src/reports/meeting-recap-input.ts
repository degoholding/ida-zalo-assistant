// Dữ liệu bản recap cuộc họp (mẫu «Meeting Recap» của DEGO, 06/10/2026) — mô hình soạn từ bản gỡ băng rồi gọi công cụ
// create_meeting_recap_pdf. Phần thuần: kiểm + chuẩn hóa tham số (mô hình có thể gửi thiếu / thừa / sai kiểu), cắt trần
// số lượng để PDF không phình vô hạn.

export type TaskPriority = "Cao" | "TB" | "Thấp";

export interface RecapTask {
  task: string;
  owner: string;
  due: string;
  priority: TaskPriority;
}

export interface RecapSection {
  heading: string;
  bullets: string[];
  subsections: { heading: string; bullets: string[] }[];
  table: { columns: string[]; rows: string[][] } | null;
}

/** meeting = recap cuộc họp (ghi âm); document = tóm tắt tài liệu / link (07/10/2026) — cùng khung PDF, khác nhãn. */
export type RecapVariant = "meeting" | "document";

export interface MeetingRecap {
  variant: RecapVariant;
  title: string;
  subtitle: string;
  docCode: string;
  version: string;
  meetingDate: string;
  duration: string;
  format: string;
  secretary: string;
  attendees: { role: string; name: string }[];
  disclaimer: string;
  tldr: string[];
  sections: RecapSection[];
  decisions: string[];
  tasks: RecapTask[];
  timeline: { when: string; content: string }[];
  openIssues: string[];
  sideNotes: string[];
  source: string;
}

export class RecapInputError extends Error {}

const text = (raw: unknown, max = 600) => (typeof raw === "string" ? raw.trim().slice(0, max) : typeof raw === "number" ? String(raw) : "");
const list = (raw: unknown, maxItems: number, maxChars = 600) =>
  (Array.isArray(raw) ? raw : []).map((item) => text(item, maxChars)).filter(Boolean).slice(0, maxItems);
const objects = (raw: unknown, maxItems: number) =>
  (Array.isArray(raw) ? raw : []).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).slice(0, maxItems);

export function normalizePriority(raw: unknown): TaskPriority {
  const value = text(raw, 20).toLowerCase();
  if (/^(cao|high|gấp|khẩn)/.test(value)) return "Cao";
  if (/^(thấp|thap|low)/.test(value)) return "Thấp";
  return "TB";
}

function normalizeTable(raw: unknown): RecapSection["table"] {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const columns = list(source.columns, 6, 60);
  if (!columns.length) return null;
  const rows = (Array.isArray(source.rows) ? source.rows : [])
    .filter((row): row is unknown[] => Array.isArray(row))
    .slice(0, 40)
    .map((row) => columns.map((_, index) => text(row[index], 400)));
  return rows.length ? { columns, rows } : null;
}

/** «2026.10.06» cho mã văn bản / tên tệp — từ ngày họp «06/10/2026» nếu đọc được, không thì hôm nay (giờ VN). */
export function compactDate(meetingDate: string, now: Date): string {
  const match = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(meetingDate);
  if (match) return `${match[3]}.${match[2].padStart(2, "0")}.${match[1].padStart(2, "0")}`;
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, ".");
}

export function normalizeRecap(args: Record<string, unknown>, now: Date, variant: RecapVariant = "meeting"): MeetingRecap {
  const meeting = variant === "meeting";
  const title = text(args.title, 140);
  if (!title) throw new RecapInputError(meeting ? "Thiếu title (tên cuộc họp, vd 'RECAP HỌP GIAO BAN DỰ ÁN K52')" : "Thiếu title (tên tài liệu)");
  const tldr = list(args.tldr, 8);
  const tasks = objects(args.tasks, 30)
    .map((item) => ({ task: text(item.task, 400), owner: text(item.owner, 120) || "(chưa rõ)", due: text(item.due, 60), priority: normalizePriority(item.priority) }))
    .filter((item) => item.task);
  if (!tldr.length && !tasks.length) throw new RecapInputError("Thiếu tldr (tóm tắt nhanh) và tasks — phải có ít nhất một trong hai");
  if (!meeting && !tldr.length) throw new RecapInputError("Thiếu tldr — bản tóm tắt tài liệu cần 4–7 ý TL;DR có số, gọi lại kèm tldr");
  const meetingDate = text(args.meeting_date, 40);
  const slug = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").replace(/^(RECAP-(HOP-)?|TOM-TAT-)/, "").slice(0, 40).replace(/-+$/, "");
  return {
    variant,
    title,
    subtitle: text(args.subtitle, 200),
    docCode: text(args.doc_code, 80) || `${meeting ? "RECAP" : "TT"}-${slug || (meeting ? "HOP" : "TAI-LIEU")}-${compactDate(meetingDate, now)}`,
    version: text(args.version, 20) || "v1.0",
    meetingDate,
    duration: text(args.duration, 40),
    format: text(args.format, 60) || (meeting ? "Google Meet" : ""),
    secretary: text(args.secretary, 60) || "Bot trợ lý (AI)",
    attendees: objects(args.attendees, 20).map((item) => ({ role: text(item.role, 80), name: text(item.name, 120) })).filter((item) => item.name),
    disclaimer: text(args.disclaimer, 300) || (meeting
      ? "Recap tổng hợp từ bản gỡ băng tự động — có thể sai sót thuật ngữ, tên riêng & con số; đề nghị đối chiếu lại khi cần."
      : "Tóm tắt tự động bằng AI từ tài liệu gốc — số liệu quan trọng đề nghị đối chiếu lại tài liệu gốc."),
    tldr,
    sections: objects(args.sections, 10).map((item) => ({
      heading: text(item.heading, 120),
      bullets: list(item.bullets, 15),
      subsections: objects(item.subsections, 6).map((sub) => ({ heading: text(sub.heading, 120), bullets: list(sub.bullets, 12) })).filter((sub) => sub.heading),
      table: normalizeTable(item.table),
    })).filter((item) => item.heading),
    decisions: list(args.decisions, 12),
    tasks,
    timeline: objects(args.timeline, 12).map((item) => ({ when: text(item.when, 60), content: text(item.content, 300) })).filter((item) => item.when || item.content),
    openIssues: list(args.open_issues, 10),
    sideNotes: list(args.side_notes, 6),
    source: text(args.source, 200),
  };
}
