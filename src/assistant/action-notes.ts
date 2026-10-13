// Dòng «việc đã làm thật» do MÁY CHỦ dựng, ghi vào ToolContext.actionNotes khi công cụ HÀNH ĐỘNG thành công.
// Lý do: lượt có bản xem trước (propose_send_message / propose_group_reminder / propose_group_pin) thay toàn bộ chữ của mô hình bằng
// `fixedReply`, nên kết quả của hành động thật làm TRƯỚC đó (tạo việc, ticket, xuất báo cáo, họp…) bị che — người
// hỏi tưởng chưa làm, bảo làm lại, đẻ trùng. assistant-service ghép các dòng này lên trước bản xem trước.
// Không có bản xem trước thì actionNotes không được dùng — câu trả lời của mô hình giữ nguyên.

export interface ActionNoteHolder {
  actionNotes?: string[];
}

type ToolArgs = Record<string, unknown>;
type NoteBuilder = (result: Record<string, unknown>, args: ToolArgs) => string[];

/** Số dòng tối đa mỗi lần gọi công cụ (save_recap_tasks có thể lưu nhiều việc) — tránh bản trả lời quá dài. */
const MAX_LINES_PER_CALL = 10;

/** Ghi một dòng; trùng nguyên văn thì bỏ (mô hình gọi lặp công cụ). */
export function addActionNote(holder: ActionNoteHolder, line: string): void {
  const text = line.trim();
  if (!text) return;
  const notes = (holder.actionNotes ??= []);
  if (!notes.includes(text)) notes.push(text);
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const isMutation = (action: unknown, readOnlyAction = "status") => text(action) !== readOnlyAction;

/** Câu trả lời của lệnh việc / ticket: thành công luôn mở đầu «Dạ …», từ chối / không thấy / thiếu quyền thì không. */
function successLine(result: Record<string, unknown>): string[] {
  const reply = text(result.result);
  if (!reply.startsWith("Dạ")) return [];
  return [reply.split("\n")[0]];
}

const BUILDERS: Record<string, NoteBuilder> = {
  create_meeting: (result) => {
    if (typeof result.meet_link !== "string") return [];
    const what = result.already_exists ? "Cuộc họp Google Meet đã có từ trước" : "Đã tạo cuộc họp Google Meet";
    return [`${what} «${String(result.title)}» lúc ${String(result.time_vn)}: ${result.meet_link}`];
  },
  cancel_meeting: (result) => (text(result.done) ? ["Đã xóa cuộc họp khỏi Google Calendar."] : []),
  create_task: successLine,
  task_action: (result, args) => (isMutation(args.action) ? successLine(result) : []),
  save_recap_tasks: (result) => {
    const saved = Number(result.saved);
    if (!(saved > 0) || !Array.isArray(result.tasks)) return [];
    return [`Đã lưu ${saved} việc vào checklist:\n${result.tasks.slice(0, MAX_LINES_PER_CALL).map((task) => `- ${String(task)}`).join("\n")}`];
  },
  create_ticket: successLine,
  ticket_action: (result, args) => (isMutation(args.action) ? successLine(result) : []),
  send_brief: (result) => (result.queued === true ? [`Đã xếp gửi ${text(result.label) || "bản tin"} cho anh/chị qua tin nhắn riêng.`] : []),
  export_report: exportLine,
  create_meeting_recap_pdf: exportLine,
  create_summary_pdf: exportLine,
  recap_drive_recording: (result) => {
    const status = text(result.status);
    return (status === "queued" || status === "done") && text(result.reply) ? [text(result.reply)] : [];
  },
};

/** Xuất tệp / trang tính: có link (Google Sheets) thì kèm link; tệp Excel / PDF thì gửi kèm sau câu trả lời. */
function exportLine(result: Record<string, unknown>): string[] {
  const link = text(result.link);
  if (link) return [`Đã xuất báo cáo lên Google Sheets: ${link}`];
  if (result.will_send_file === true) return [`Đã tạo tệp ${text(result.format) === "pdf" ? "PDF" : "Excel"} «${text(result.file_name)}», em gửi kèm ngay sau tin này.`];
  return [];
}

/** Gọi sau khi công cụ chạy xong: kết quả có `error` hoặc công cụ không phải hành động thì không ghi gì. */
export function recordActionNotes(holder: ActionNoteHolder, toolName: string, args: ToolArgs, result: Record<string, unknown>): void {
  const build = BUILDERS[toolName];
  if (!build || result.error !== undefined) return;
  for (const line of build(result, args)) addActionNote(holder, line);
}
