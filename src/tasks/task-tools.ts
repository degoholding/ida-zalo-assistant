import crypto from "node:crypto";
import { ContactKind, TaskPriority, TaskSource } from "../constants.js";
import type { FunctionDeclaration } from "../assistant/gemini-client.js";
import type { TaskCommand, TaskListScope } from "./task-command-parser.js";
import { resolveAssignee, runTaskCommand, type TaskCommandContext } from "./task-commands.js";
import { parseDueArgument } from "./task-due-parser.js";
import { formatDue } from "./task-format.js";
import { announceNewTasks } from "./task-notify.js";
import { shortTaskCode, type TaskActor, type TaskParty, type TaskRow } from "./task-repository.js";
import { createTask } from "./task-service.js";

// Công cụ việc (checklist, phase 7) cho trợ lý AI: câu tự nhiên («Minh làm xong báo giá rồi nhé», «dời việc đó sang thứ 2»)
// → mô hình gọi công cụ → chạy ĐÚNG đường của lệnh gõ (runTaskCommand), nên luật quyền y hệt. Riêng save_recap_tasks lưu
// cả bảng phân công của một bản recap họp khi người hỏi đồng ý.

const ACTIONS = ["status", "done", "reschedule", "reassign", "cancel", "reopen", "confirm", "reject", "note"] as const;
type TaskToolAction = (typeof ACTIONS)[number];
const SCOPES: TaskListScope[] = ["mine", "group", "overdue", "proposed"];
const MAX_RECAP_TASKS = 30;
const PRIORITIES: Record<string, TaskPriority> = { cao: TaskPriority.High, tb: TaskPriority.Normal, "trung bình": TaskPriority.Normal, thấp: TaskPriority.Low };

const DUE_HELP = "Hạn: ISO 8601 giờ VN (ngày không giờ: «2026-10-16»; có giờ: «2026-10-16T17:00:00+07:00») hoặc chữ («thứ 6», «mai 17h»).";

export const TASK_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "list_tasks",
    description: "Danh sách việc trong checklist. scope: mine = việc người hỏi phụ trách / đã giao; group = mọi việc đang làm (hỏi trong " +
      "nhóm = việc của nhóm đó); overdue = việc quá hạn; proposed = đề xuất chờ xác nhận.",
    parameters: { type: "object", properties: { scope: { type: "string", enum: SCOPES } } },
  },
  {
    name: "create_task",
    description: "Giao MỘT việc mới khi người hỏi GIAO VIỆC rõ ràng («giao Minh gửi báo giá trước thứ 6», «nhờ Lan chốt công nợ mai»). " +
      "Không tạo từ câu kể chuyện / hỏi han. assignee = tên người làm như người hỏi gọi. " + DUE_HELP + " Công cụ tự tìm người, tự báo người đó.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Việc cần làm, ngắn gọn, bắt đầu bằng động từ" },
        assignee: { type: "string" },
        due: { type: "string" },
        priority: { type: "string", enum: ["Cao", "TB", "Thấp"] },
      },
      required: ["title", "assignee"],
    },
  },
  {
    name: "task_action",
    description: "Làm một việc với MỘT việc trong checklist: status = xem; done = đã xong (note = ghi chú); reschedule = dời hạn (due); " +
      "reassign = giao lại (assignee = tên); cancel = hủy (note = lý do); reopen = mở lại; confirm / reject = lưu / bỏ một đề xuất; " +
      "note = ghi chú, nhắn các bên. task_id là số trong mã (V-12 → 12). «Việc đó / nó» = việc vừa nhắc; không rõ việc nào thì " +
      "list_tasks rồi hỏi lại. " + DUE_HELP,
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "integer" },
        action: { type: "string", enum: [...ACTIONS] },
        due: { type: "string" },
        assignee: { type: "string" },
        note: { type: "string" },
      },
      required: ["task_id", "action"],
    },
  },
  {
    name: "save_recap_tasks",
    description: "Người hỏi đồng ý lưu các việc của một bản recap họp vào checklist: truyền ĐÚNG danh sách «Phân công» của bản recap " +
      "(người, việc, hạn như đã ghi). Người không tìm thấy / hạn không rõ vẫn lưu, công cụ báo lại để bổ sung.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: { task: { type: "string" }, owner: { type: "string" }, due: { type: "string" }, priority: { type: "string" } },
            required: ["task"],
          },
        },
      },
      required: ["tasks"],
    },
  },
];

export const TASK_TOOL_NAMES = new Set(TASK_TOOL_DECLARATIONS.map((tool) => tool.name));

export const TASK_TOOLS_PROMPT = `

VIỆC (checklist, bot nhắc theo hạn): người hỏi giao việc / hỏi việc / báo xong / dời hạn / giao lại → gọi create_task / list_tasks /
task_action NGAY lượt này rồi báo đúng kết quả công cụ, 1–2 câu. Chỉ create_task khi có lời GIAO VIỆC rõ ràng; thiếu người làm thì
hỏi lại. Không bảo người hỏi tự gõ lệnh khi công cụ làm được.`;

function toCommand(action: TaskToolAction, taskId: number, args: Record<string, unknown>): TaskCommand | { error: string } {
  const note = String(args.note ?? "").trim().slice(0, 2000);
  switch (action) {
    case "status": return { kind: "task_status", taskId };
    case "done": return { kind: "task_done", taskId, note };
    case "cancel": return { kind: "task_cancel", taskId, note };
    case "reopen": return { kind: "task_reopen", taskId, note };
    case "confirm": return { kind: "task_confirm", taskId };
    case "reject": return { kind: "task_reject", taskId };
    case "note": return note ? { kind: "task_note", taskId, note } : { error: "Thiếu nội dung ghi chú." };
    case "reschedule": return typeof args.due === "string" && args.due.trim() ? { kind: "task_reschedule", taskId, dueText: args.due.trim() } : { error: "Thiếu hạn mới (due)." };
    case "reassign": return typeof args.assignee === "string" && args.assignee.trim() ? { kind: "task_reassign", taskId, assigneeName: args.assignee.trim() } : { error: "Thiếu tên người mới (assignee)." };
  }
}

/** Lưu bảng phân công recap: mỗi dòng một việc (người hỏi là người giao), báo lại dòng thiếu người / thiếu hạn. */
async function saveRecapTasks(ctx: TaskCommandContext, args: Record<string, unknown>, now: Date): Promise<Record<string, unknown>> {
  if (!(await ctx.isOverseer()) && ctx.contact.kind !== ContactKind.Staff) return { error: "Chỉ nhân sự công ty mới lưu việc vào checklist được." };
  const items = Array.isArray(args.tasks) ? args.tasks.slice(0, MAX_RECAP_TASKS) as Record<string, unknown>[] : [];
  if (!items.length) return { error: "Không có việc nào trong danh sách." };
  const assigner: TaskActor = { contactId: ctx.contact.id, uid: ctx.contact.uid, name: ctx.contact.name, via: "zalo" };
  const saved: string[] = [];
  const warnings: string[] = [];
  const createdTasks: TaskRow[] = [];
  for (const item of items) {
    const title = String(item.task ?? "").trim();
    if (title.length < 3) continue;
    const ownerName = String(item.owner ?? "").trim();
    let assignee: TaskParty | null = null;
    if (ownerName && !/^\(?chưa rõ\)?$/i.test(ownerName)) {
      const person = await resolveAssignee(ctx, ownerName, "giao lại V-n <tên>");
      assignee = "party" in person ? person.party : { contactId: null, uid: null, name: ownerName };
    }
    const due = parseDueArgument(item.due, now);
    // Gọi lại (mô hình gọi hai lần / người hỏi «ok» hai lần) không tạo trùng; báo gộp MỘT lượt sau vòng lặp
    const dedupeKey = ctx.messageId ? `recap:${ctx.messageId}:${crypto.createHash("sha1").update(`${title}|${ownerName}`).digest("hex").slice(0, 16)}` : undefined;
    const task = await createTask(ctx.deps, {
      title, assignee, assigner, source: TaskSource.Recap, sourceThreadId: ctx.threadId, sourceMessageId: ctx.messageId, dedupeKey, silent: true,
      due: due ? { at: due.at, hasTime: due.hasTime } : null, priority: PRIORITIES[String(item.priority ?? "").toLowerCase()], via: "zalo",
    });
    if (!task) continue;
    createdTasks.push(task);
    saved.push(`${shortTaskCode(task)} ${task.title} — ${task.assignee?.name || "chưa có người"} — hạn ${formatDue(task.due_at, task.due_has_time, now)}`);
    if (assignee && !assignee.uid) warnings.push(`${shortTaskCode(task)}: không tìm thấy «${ownerName}» trên Zalo — «giao lại ${shortTaskCode(task)} <tên>» để bot nhắc được`);
    if (!assignee) warnings.push(`${shortTaskCode(task)}: chưa có người phụ trách`);
    if (!due) warnings.push(`${shortTaskCode(task)}: chưa có hạn — «dời ${shortTaskCode(task)} <hạn>»`);
  }
  if (createdTasks.length) await announceNewTasks(ctx.deps, createdTasks, `recap:${ctx.messageId ?? createdTasks[0].id}`);
  if (!saved.length) return { saved: 0, note: "Các việc này đã được lưu từ trước (không tạo lại)." };
  return { saved: saved.length, tasks: saved, ...(warnings.length ? { need_follow_up: warnings } : {}) };
}

export async function runTaskTool(ctx: TaskCommandContext | undefined, name: string, args: Record<string, unknown>, now: Date): Promise<Record<string, unknown>> {
  if (!ctx) return { error: "Checklist chưa bật ở bot này." };
  if (name === "list_tasks") {
    const scope = SCOPES.includes(args.scope as TaskListScope) ? args.scope as TaskListScope : "mine";
    return { result: await runTaskCommand(ctx, { kind: "task_list", scope }, now) };
  }
  if (name === "save_recap_tasks") return saveRecapTasks(ctx, args, now);
  if (name === "create_task") {
    const title = String(args.title ?? "").trim().slice(0, 300);
    const assigneeName = String(args.assignee ?? "").trim();
    if (title.length < 3) return { error: "Thiếu nội dung việc." };
    if (!assigneeName) return { error: "Thiếu người làm — hỏi lại người hỏi giao cho ai." };
    const priority = PRIORITIES[String(args.priority ?? "").toLowerCase()];
    return { result: await runTaskCommand(ctx, { kind: "task_create", title, assigneeName, dueText: String(args.due ?? "").trim(), priority, source: TaskSource.Assistant }, now) };
  }
  const taskId = Number(args.task_id);
  const action = String(args.action ?? "") as TaskToolAction;
  if (!Number.isSafeInteger(taskId) || taskId <= 0) return { error: "Thiếu số việc (V-12 → 12)." };
  if (!ACTIONS.includes(action)) return { error: "Việc không hợp lệ." };
  const command = toCommand(action, taskId, args);
  if ("error" in command) return command;
  return { result: await runTaskCommand(ctx, command, now) };
}
