import { ContactKind, ContactRole, TaskSource, TaskStatus } from "../constants.js";
import { isActiveRecipientUid } from "../recipients/recipient-repository.js";
import { cleanPersonName, describeContactChoices, pickContactMatch, searchContactsByName } from "../sync/contact-search.js";
import type { TaskCommand, TaskListScope } from "./task-command-parser.js";
import { parseDueArgument } from "./task-due-parser.js";
import { describeTask, describeTaskLine, formatDue } from "./task-format.js";
import { canManageTask, canViewTask, canWorkOnTask, type TaskViewer } from "./task-permissions.js";
import { findTask, listTasks, shortTaskCode, type TaskActor, type TaskParty } from "./task-repository.js";
import {
  addTaskNote, cancelTask, confirmTask, createTask, finishTask, rejectTask, reopenTask, reassignTask, rescheduleTask, TaskActionError,
  type TaskDeps,
} from "./task-service.js";

// Chạy lệnh việc gõ trên Zalo (task-command-parser.ts) — công cụ trợ lý (task-tools.ts) cũng đi đúng đường này.

export interface TaskCommandContext {
  deps: TaskDeps;
  /** kind = ContactKind — khách hàng không giao việc được */
  contact: { id: number; uid: string; name: string; role: number; kind: number };
  /** Cuộc đang nhắn + tin chứa lệnh (việc mới gắn vào đây — bot nhắc vào đúng nhóm này) */
  threadId: number | null;
  messageId: number | null;
  /** Hỏi trong nhóm: id nhóm (chỉ thấy việc của nhóm) — null = tin riêng */
  groupId: number | null;
  /** Người có vai trò hoặc người nhận đang bật (hỏi DB một lần / lượt) */
  isOverseer: () => Promise<boolean>;
}

export function buildTaskContext(deps: TaskDeps, input: Omit<TaskCommandContext, "deps" | "isOverseer">): TaskCommandContext {
  let cached: Promise<boolean> | null = null;
  const overseer = () => (cached ??= input.contact.role !== ContactRole.None ? Promise.resolve(true) : isActiveRecipientUid(deps.db, input.contact.uid));
  return { deps, ...input, isOverseer: overseer };
}

const LIST_LIMIT = 30;
const NOT_FOUND = (id: number) => `Em không thấy việc V-${id} của anh/chị. Nhắn «việc» để xem danh sách.`;
const NO_RIGHT = "Anh/chị không có quyền làm việc này — chỉ người giao việc hoặc quản lý.";

/** Người phụ trách theo tên người gõ: một người rõ ràng → party; không rõ → câu trả lời cho người gõ. */
export async function resolveAssignee(ctx: TaskCommandContext, rawName: string, retryHint: string): Promise<{ party: TaskParty } | { reply: string }> {
  const name = cleanPersonName(rawName);
  const matches = await searchContactsByName(ctx.deps.db, name, { groupId: ctx.groupId ?? ctx.threadId });
  if (!matches.length) return { reply: `Em không tìm thấy ai tên «${name}» trong Danh bạ. Anh/chị nhắn lại «${retryHint}» với tên đầy đủ giúp em.` };
  const picked = pickContactMatch(matches);
  if (picked) return { party: { contactId: picked.id, uid: picked.uid, name: picked.name } };
  return { reply: describeContactChoices(matches, name, retryHint) };
}

async function listText(ctx: TaskCommandContext, viewer: TaskViewer, scope: TaskListScope, now: Date): Promise<string> {
  const inGroup = ctx.groupId !== null;
  const everyone = viewer.overseer || inGroup;
  const filter = {
    statuses: scope === "proposed" ? [TaskStatus.Proposed] : [TaskStatus.Open],
    threadId: ctx.groupId ?? undefined,
    involvingUid: scope === "mine" || !everyone ? viewer.uid : undefined,
    overdueAt: scope === "overdue" ? now : undefined,
  };
  const tasks = await listTasks(ctx.deps.db, { ...filter, limit: LIST_LIMIT });
  const titles: Record<TaskListScope, string> = {
    mine: "VIỆC CỦA ANH/CHỊ (đang phụ trách hoặc đã giao)", group: inGroup ? "VIỆC CỦA NHÓM" : "VIỆC ĐANG LÀM",
    overdue: "VIỆC QUÁ HẠN", proposed: "VIỆC CHỜ XÁC NHẬN",
  };
  if (!tasks.length) return scope === "proposed" ? "Không có đề xuất nào chờ xác nhận." : "Không có việc nào.";
  const code = shortTaskCode(tasks[0]);
  const hint = scope === "proposed" ? `Nhắn «ok ${code}» để lưu, «bỏ ${code}» nếu không phải việc.` : `Nhắn «xong ${code}», «dời ${code} <hạn>», «${code}» để xem chi tiết.`;
  const count = tasks.length >= LIST_LIMIT ? `${LIST_LIMIT}+, ${LIST_LIMIT} việc gần hạn nhất` : String(tasks.length);
  return [`${titles[scope]} (${count})`, ...tasks.map((task) => describeTaskLine(task, now)), "", hint].join("\n");
}

export async function runTaskCommand(ctx: TaskCommandContext, command: TaskCommand, now: Date): Promise<string> {
  const { deps, contact } = ctx;
  const actor: TaskActor = { contactId: contact.id, uid: contact.uid, name: contact.name, via: "zalo" };
  const viewer: TaskViewer = { uid: contact.uid, contactId: contact.id, overseer: await ctx.isOverseer(), groupId: ctx.groupId };
  if (command.kind === "task_list") return listText(ctx, viewer, command.scope, now);
  if (command.kind === "task_create") {
    // Cổng tin riêng cho lệnh việc qua với mọi người (để người phụ trách báo xong) — giao việc thì chỉ nhân sự / sếp
    if (!viewer.overseer && contact.kind !== ContactKind.Staff) return "Chỉ nhân sự công ty mới giao việc qua bot được.";
    const due = command.dueText ? parseDueArgument(command.dueText, now) : null;
    if (command.dueText && !due) return `Em chưa hiểu hạn «${command.dueText}». Ghi hạn dạng «mai», «thứ 6», «20/10», «17h thứ 6» giúp em.`;
    const person = await resolveAssignee(ctx, command.assigneeName, "giao <tên>: <việc> hạn <ngày>");
    if ("reply" in person) return person.reply;
    const task = (await createTask(deps, {
      title: command.title, assignee: person.party, assigner: actor, source: command.source ?? TaskSource.Command, priority: command.priority,
      sourceThreadId: ctx.threadId, sourceMessageId: ctx.messageId, due: due ? { at: due.at, hasTime: due.hasTime } : null, via: "zalo",
    }))!;
    const notified = person.party.uid !== contact.uid ? `; em đã báo ${person.party.name}` : "";
    return `Dạ đã ghi ${shortTaskCode(task)}: ${task.title} — ${person.party.name} — hạn ${formatDue(task.due_at, task.due_has_time, now)}${notified}.` +
      (due ? "" : ` Chưa có hạn: nhắn «dời ${shortTaskCode(task)} <hạn>» để đặt.`);
  }

  const task = await findTask(deps.db, command.taskId);
  if (!task || !canViewTask(viewer, task)) return NOT_FOUND(command.taskId);
  const code = shortTaskCode(task);
  try {
    switch (command.kind) {
      case "task_status":
        return describeTask(task, now);
      case "task_done":
        if (!canWorkOnTask(viewer, task)) return "Chỉ người phụ trách, người giao hoặc quản lý mới báo xong được.";
        await finishTask(deps, task, actor, command.note);
        return `Dạ đã đánh xong ${code}${task.assigner.uid && task.assigner.uid !== contact.uid ? ` và báo ${task.assigner.name}` : ""}.`;
      case "task_note":
        if (!canWorkOnTask(viewer, task)) return "Chỉ người phụ trách, người giao hoặc quản lý mới ghi chú được.";
        await addTaskNote(deps, task, actor, command.note);
        return `Dạ em đã ghi chú vào ${code}.`;
      case "task_reschedule": {
        if (!canManageTask(viewer, task)) return NO_RIGHT;
        const due = parseDueArgument(command.dueText, now);
        if (!due) return `Em chưa hiểu hạn «${command.dueText}». Ghi hạn dạng «mai», «thứ 6», «20/10», «17h thứ 6» giúp em.`;
        const updated = await rescheduleTask(deps, task, actor, due);
        return `Dạ đã đổi hạn ${code} thành ${formatDue(updated.due_at, updated.due_has_time, now)}.`;
      }
      case "task_reassign": {
        if (!canManageTask(viewer, task)) return NO_RIGHT;
        const person = await resolveAssignee(ctx, command.assigneeName, `giao lại ${code} <tên>`);
        if ("reply" in person) return person.reply;
        await reassignTask(deps, task, actor, person.party);
        return `Dạ đã giao lại ${code} cho ${person.party.name}.`;
      }
      case "task_cancel":
        if (!canManageTask(viewer, task)) return NO_RIGHT;
        await cancelTask(deps, task, actor, command.note);
        return `Dạ đã hủy ${code}.`;
      case "task_reopen":
        if (!canManageTask(viewer, task)) return NO_RIGHT;
        await reopenTask(deps, task, actor, command.note);
        return `Dạ đã mở lại ${code}.`;
      case "task_confirm": {
        if (!canManageTask(viewer, task)) return NO_RIGHT;
        const confirmed = await confirmTask(deps, task, actor);
        return `Dạ đã lưu ${code} vào checklist${confirmed.assignee?.uid ? ` và báo ${confirmed.assignee.name}` : " (chưa có người phụ trách — nhắn «giao lại " + code + " <tên>»)"}.`;
      }
      case "task_reject":
        if (!canManageTask(viewer, task)) return NO_RIGHT;
        await rejectTask(deps, task, actor);
        return `Dạ em đã bỏ đề xuất ${code}.`;
    }
  } catch (error) {
    if (error instanceof TaskActionError) return error.message;
    throw error;
  }
}
