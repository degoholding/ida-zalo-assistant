import crypto from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { TaskSource } from "../constants.js";
import type { Db } from "../db/pool.js";
import { enqueueContactMessage, type MessageQueueDeps } from "../messaging/contact-message.js";
import type { GeneratedReportFile } from "../reports/report-exporter.js";
import type { MeetingRecap } from "../reports/meeting-recap-input.js";
import { findContactByUid } from "../sync/contact-repository.js";
import { pickContactMatch, searchContactsByName } from "../sync/contact-search.js";
import { parseDueArgument } from "../tasks/task-due-parser.js";
import { formatDue } from "../tasks/task-format.js";
import { findTaskByDedupeKey, shortTaskCode, type TaskParty, type TaskRow } from "../tasks/task-repository.js";
import { createTask } from "../tasks/task-service.js";

// Soạn tin recap (THUẦN) + tạo việc «chờ xác nhận» + xếp hàng gửi (phase 4, recap họp tự động từ Drive). Mỗi dòng
// «Phân công» AI đọc ra → một việc Proposed (TaskSource.Recap) — người đặt họp / sếp xác nhận bằng «ok hết» / «ok V-12»
// (task-command-parser.ts, task-commands.ts); việc tự bỏ sau 2 ngày làm việc nếu không ai xác nhận (task-reminders.ts
// đường cũ của phase 7 lo mốc tự bỏ, không thêm gì ở đây).

const MAX_TASKS = 30;
const MAX_MESSAGE_LINES = 14;
const MAX_TASK_LINES_SHOWN = 8;

export interface RecapTaskLine {
  code: string;
  owner: string;
  title: string;
  due: string;
}

/** Dòng «@<người đặt> lưu các việc này vào checklist?…» — `askName` = «@Tên» (nhóm, khi requester là thành viên) hoặc «Anh/chị» (tin riêng). */
export function buildConfirmLine(firstCode: string, askName: string): string {
  return `${askName} lưu các việc này vào checklist? Trả lời «ok hết» để lưu tất cả, «ok ${firstCode}» từng việc, ` +
    "«bỏ hết» nếu không cần. Không trả lời thì sau 2 ngày làm việc em tự bỏ.";
}

export interface RecapMessageInput {
  title: string;
  meetingDate: string;
  duration: string;
  fileName: string;
  tldr: string[];
  tasks: RecapTaskLine[];
  /** null = không có việc nào được tạo — bỏ hẳn phần hỏi xác nhận. */
  confirmLine: string | null;
}

/** Tin recap gửi vào nhóm / tin riêng (≤ 14 dòng, chốt phase-04). THUẦN. */
export function composeRecapMessage(input: RecapMessageInput): string {
  const meta = [input.meetingDate, input.duration].filter(Boolean).join(" ");
  const lines = [
    `Recap cuộc họp «${input.title}»${meta ? ` (${meta})` : ""} — từ ghi âm «${input.fileName}»`,
    ...input.tldr.slice(0, 3).map((line) => `- ${line}`),
  ];
  if (input.tasks.length) {
    lines.push("Phân công:");
    for (const task of input.tasks.slice(0, MAX_TASK_LINES_SHOWN)) {
      lines.push(`${task.code} ${task.owner} — ${task.title} — hạn ${task.due}`);
    }
    if (input.confirmLine) lines.push(input.confirmLine);
  }
  return lines.slice(0, MAX_MESSAGE_LINES).join("\n");
}

export interface ProposeRecapTasksContext {
  recordingId: number;
  /** Nhóm đặt họp (để tìm người theo tên trong đúng nhóm đó) — null = tin riêng, không giới hạn nhóm. */
  groupId: number | null;
  sourceThreadId: number | null;
  assigner: TaskParty;
  now: Date;
  /** M7: mốc tính hạn tương đối («mai», «thứ 6») — giờ HỌP (driveCreatedAt khi cuộc cũ không có mốc bắt đầu), KHÔNG
   * phải lúc xử lý (`now`): tệp tải trễ / bị hoãn trần token tới cả ngày sau mới gỡ băng thì hạn vẫn phải đúng ý người
   * nói trong họp. */
  dueAnchor: Date;
}

export interface ProposedRecapTask {
  row: TaskRow;
  line: RecapTaskLine;
}

/** «(chưa rõ)» — AI không xác định được người làm (meeting-recap-prompt.ts hướng dẫn ghi đúng chuỗi này). */
const UNKNOWN_OWNER = /^\(?chưa rõ\)?$/i;

/** Mỗi dòng `recap.tasks` (≤ 30) → một việc Proposed; trùng dòng cũ (thử lại) không tạo đôi nhờ `dedupeKey`. */
export async function proposeRecapTasks(deps: MessageQueueDeps, tasks: MeetingRecap["tasks"], ctx: ProposeRecapTasksContext): Promise<ProposedRecapTask[]> {
  const out: ProposedRecapTask[] = [];
  for (const item of tasks.slice(0, MAX_TASKS)) {
    let assignee: TaskParty | null = null;
    if (item.owner && !UNKNOWN_OWNER.test(item.owner)) {
      const matches = await searchContactsByName(deps.db, item.owner, { groupId: ctx.groupId ?? undefined });
      const picked = pickContactMatch(matches);
      assignee = picked ? { contactId: picked.id, uid: picked.uid, name: picked.name } : { contactId: null, uid: null, name: item.owner };
    }
    const due = parseDueArgument(item.due, ctx.dueAnchor);
    const dedupeKey = `meetrec:${ctx.recordingId}:${crypto.createHash("sha1").update(`${item.task}|${item.owner}`).digest("hex").slice(0, 16)}`;
    let task = await createTask(deps, {
      title: item.task, assignee, assigner: ctx.assigner, source: TaskSource.Recap, sourceThreadId: ctx.sourceThreadId,
      due: due ? { at: due.at, hasTime: due.hasTime } : null, proposed: true, dedupeKey, via: "system",
    });
    // M4: trùng dedupeKey (thử lại sau khi việc TRƯỚC NÓ trong vòng lặp lỗi dở dang) → createTask trả null — lấy lại
    // việc đã tạo lần trước, không để việc đó rơi khỏi tin recap / `task_ids` (người nhận mất luôn mã để «ok V-x»)
    if (!task) task = await findTaskByDedupeKey(deps.db, dedupeKey);
    if (!task) continue;
    out.push({
      row: task,
      line: { code: shortTaskCode(task), owner: assignee?.name || item.owner || "(chưa rõ)", title: task.title, due: formatDue(task.due_at, task.due_has_time, ctx.now) },
    });
  }
  return out;
}

export interface RecapDestination {
  threadId?: number;
  zaloUid?: string;
  name?: string;
}

/** Người giao việc = người đặt họp (contact theo `requester_uid`); không có → «Recap tự động» (không uid, không báo kiểu người). */
export async function resolveRecapAssigner(db: Db, requesterUid: string | null): Promise<TaskParty> {
  if (!requesterUid) return { contactId: null, uid: null, name: "Recap tự động" };
  const contact = await findContactByUid(db, requesterUid);
  const name = contact ? contact.display_name || contact.zalo_name : "";
  return { contactId: contact?.id ?? null, uid: requesterUid, name: name || "Recap tự động" };
}

/** «@Tên» khi người đặt họp là thành viên nhóm đích (gắn thẻ nhắc thật); tin riêng / không rõ thì «Anh/chị». */
export async function resolveRecapAskName(db: Db, groupId: number | null, requesterUid: string | null): Promise<{ askName: string; mentionUids: string[] }> {
  if (!requesterUid || !groupId) return { askName: "Anh/chị", mentionUids: [] };
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT COALESCE(NULLIF(display_name, ''), zalo_name) AS name FROM group_member WHERE group_id = ? AND zalo_uid = ? AND left_at IS NULL LIMIT 1",
    [groupId, requesterUid]);
  const name = rows[0] ? String(rows[0].name ?? "") : "";
  return name ? { askName: `@${name}`, mentionUids: [requesterUid] } : { askName: "Anh/chị đặt họp", mentionUids: [] };
}

/** Xếp tin recap + PDF vào hàng đợi `ContactMessage` — `dedupeKey` theo dòng `meeting_recording` nên thử lại không gửi đôi. */
export async function enqueueRecapDelivery(
  deps: MessageQueueDeps, recordingId: number, destination: RecapDestination, text: string, mentionUids: string[],
  file: GeneratedReportFile, delayMs: number,
): Promise<void> {
  await enqueueContactMessage(deps, { ...destination, text, mentionUids, reportFiles: [file] }, `meetrec:${recordingId}`, delayMs);
}

/** Tin báo RIÊNG người đặt họp (nhóm Mật) hoặc tin lỗi đích gửi — không kèm tệp. `dedupeKey` tránh gửi đôi khi thử lại.
 * `delayMs` (L7): hoãn qua giờ yên lặng như tin recap thành công — mặc định 0 (gửi ngay) cho nơi gọi chưa cần hoãn. */
export async function enqueueRecapNotice(deps: MessageQueueDeps, recordingId: number, destination: RecapDestination, text: string, tag: string, delayMs = 0): Promise<void> {
  await enqueueContactMessage(deps, { ...destination, text }, `meetrec:${recordingId}:${tag}`, delayMs);
}
