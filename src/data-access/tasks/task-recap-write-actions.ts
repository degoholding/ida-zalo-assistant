import crypto from "node:crypto";
import { z } from "zod/v4";
import { TaskSource, TaskStatus } from "../../constants.js";
import { findLatestRecapTaskIds } from "../../meetings/meeting-recording-repository.js";
import { decideTaskRelationship, taskActorOf } from "../actors/contact-relationship-rules.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { resolvePersonName } from "../resolvers/person-name-resolver.js";
import { resolveDueText } from "../resolvers/due-text-resolver.js";
import type { WriteAction } from "../write/write-action.js";
import type { TaskRecapDecisionResult } from "../../tasks/task-command-replies.js";
import { formatDue } from "../../tasks/task-format.js";
import { announceNewTasks } from "../../tasks/task-notify.js";
import { findTask, shortTaskCode, type TaskParty, type TaskRow } from "../../tasks/task-repository.js";
import { confirmTask, createTask, rejectTask, TaskActionError, type TaskDeps } from "../../tasks/task-service.js";
import { assertMayAssign, priorityOfText, requireTaskActor } from "./task-actor-rules.js";
import { personResolveOptions } from "./task-relationship-write-actions.js";
import { executedTask } from "./task-write-outcomes.js";

// Hai thao tác ghi việc theo loạt (recap họp), GHI NGAY như đường cũ (BC1 bỏ): lưu cả bảng phân công recap (`save_recap_tasks` của mô hình), và gộp
// xác nhận / bỏ các đề xuất của recap tự động GẦN NHẤT («ok hết» / «bỏ hết» gõ tay). Chép đúng `saveRecapTasks` (task-tools-legacy.ts) và
// `runRecapBulkCommand` (task-commands-legacy.ts).

export const MAX_RECAP_TASKS = 30;
const taskDeps = (ctx: DataAccessContext): TaskDeps => ({ db: ctx.db, wakeJobs: ctx.wakeJobs });
const RECAP_STAFF_ONLY = "Chỉ nhân sự công ty mới lưu việc vào checklist được.";

const recapItem = z.object({
  task: z.string(),
  owner: z.string().optional(),
  due: z.string().optional(),
  priority: z.string().optional(),
});
const batchSchema = z.object({ tasks: z.array(recapItem) }).strict();
type BatchInput = z.infer<typeof batchSchema>;

/** Kết quả lưu loạt — đúng hình công cụ `save_recap_tasks` cũ trả cho mô hình. */
export interface TaskRecapSavedResult {
  saved: number;
  note?: string;
  tasks?: string[];
  need_follow_up?: string[];
}

async function assertMayBatch(ctx: DataAccessContext): Promise<void> {
  try {
    await assertMayAssign(requireTaskActor(ctx));
  } catch (error) {
    if (error instanceof DataAccessError && error.detail?.reason === "staff_only") throw new DataAccessError("forbidden", RECAP_STAFF_ONLY);
    throw error;
  }
}

export const taskRelationshipBatchCreate: WriteAction<BatchInput> = {
  tool: "task_relationship_batch_create",
  title: "Lưu bảng phân công recap họp (người đang nhắn bot)",
  description: "Người đang nhắn bot lưu cả bảng «Phân công» của một bản recap họp vào checklist (mỗi dòng một việc, người hỏi là người giao).",
  entity: "task",
  permission: "relationship",
  confirmMode: "immediate",
  schema: batchSchema,
  async prepare(ctx, input) {
    await assertMayBatch(ctx);
    const items = input.tasks.slice(0, MAX_RECAP_TASKS);
    if (!items.length) throw new DataAccessError("invalid_value", "Không có việc nào trong danh sách.");
    return { preview: `Lưu ${items.length} việc của recap vào checklist`, targetEntity: "task", targetId: null, stateToken: "" };
  },
  async execute(ctx, input) {
    await assertMayBatch(ctx);
    const actor = requireTaskActor(ctx);
    const deps = taskDeps(ctx);
    const assigner = taskActorOf(actor);
    const saved: string[] = [];
    const warnings: string[] = [];
    const createdTasks: TaskRow[] = [];
    for (const item of input.tasks.slice(0, MAX_RECAP_TASKS)) {
      const title = item.task.trim();
      if (title.length < 3) continue;
      const ownerName = (item.owner ?? "").trim();
      let assignee: TaskParty | null = null;
      if (ownerName && !/^\(?chưa rõ\)?$/i.test(ownerName)) {
        const found = await resolvePersonName(ctx.db, ownerName, await personResolveOptions(ctx, actor));
        assignee = found.kind === "one" ? { contactId: found.contact.id, uid: found.contact.uid, name: found.contact.name } : { contactId: null, uid: null, name: ownerName };
      }
      const due = resolveDueText(item.due, ctx.now);
      // Gọi lại (mô hình gọi hai lần / người hỏi «ok» hai lần) không tạo trùng; báo gộp MỘT lượt sau vòng lặp
      const dedupeKey = actor.messageId ? `recap:${actor.messageId}:${crypto.createHash("sha1").update(`${title}|${ownerName}`).digest("hex").slice(0, 16)}` : undefined;
      const task = await createTask(deps, {
        title, assignee, assigner, source: TaskSource.Recap, sourceThreadId: actor.threadId, sourceMessageId: actor.messageId, dedupeKey, silent: true,
        due: due ? { at: due.at, hasTime: due.hasTime } : null, priority: priorityOfText(item.priority), via: "zalo",
      });
      if (!task) continue;
      createdTasks.push(task);
      const code = shortTaskCode(task);
      saved.push(`${code} ${task.title} — ${task.assignee?.name || "chưa có người"} — hạn ${formatDue(task.due_at, task.due_has_time, ctx.now)}`);
      if (assignee && !assignee.uid) warnings.push(`${code}: không tìm thấy «${ownerName}» trên Zalo — «giao lại ${code} <tên>» để bot nhắc được`);
      if (!assignee) warnings.push(`${code}: chưa có người phụ trách`);
      if (!due) warnings.push(`${code}: chưa có hạn — «dời ${code} <hạn>»`);
    }
    if (createdTasks.length) await announceNewTasks(deps, createdTasks, `recap:${actor.messageId ?? createdTasks[0].id}`);
    const outcome: TaskRecapSavedResult = saved.length
      ? { saved: saved.length, tasks: saved, ...(warnings.length ? { need_follow_up: warnings } : {}) }
      : { saved: 0, note: "Các việc này đã được lưu từ trước (không tạo lại)." };
    return executedTask(outcome, createdTasks[0]?.id ?? null, `Lưu ${saved.length} việc recap`, "Lưu việc recap");
  },
};

const decideSchema = z.object({ decision: z.enum(["confirm", "reject"]) }).strict();
type DecideInput = z.infer<typeof decideSchema>;

/**
 * «ok hết» / «bỏ hết»: gộp xác nhận / bỏ các việc Proposed của ĐÚNG recap tự động GẦN NHẤT gửi vào cuộc đang hỏi. Không có recap nào khớp (hoặc việc của
 * nó không còn Proposed / không đủ quyền) → kết quả `none` (lớp lệnh trả null để AI trả lời như câu thường).
 */
export const taskRelationshipRecapDecide: WriteAction<DecideInput> = {
  tool: "task_relationship_recap_decide",
  title: "Lưu / bỏ cả loạt đề xuất của recap họp gần nhất",
  description: "Người đang nhắn bot lưu hoặc bỏ mọi đề xuất việc của recap họp tự động gần nhất gửi vào cuộc này (người giao hoặc quản lý).",
  entity: "task",
  permission: "relationship",
  confirmMode: "immediate",
  schema: decideSchema,
  async prepare(ctx, input) {
    requireTaskActor(ctx);
    return { preview: input.decision === "confirm" ? "Lưu các việc đề xuất của recap gần nhất" : "Bỏ các đề xuất của recap gần nhất", targetEntity: "task", targetId: null, stateToken: "" };
  },
  async execute(ctx, input) {
    const actor = requireTaskActor(ctx);
    const confirm = input.decision === "confirm";
    const none = executedTask<TaskRecapDecisionResult>({ outcome: "none" }, null, "Không có đề xuất recap nào khớp", "Không đổi");
    // Tin riêng mà không rõ ai đang hỏi (uid rỗng, vd lỗi đồng bộ danh bạ) — không có cách lọc đúng người, TỪ CHỐI thay vì gộp nhầm việc toàn hệ thống
    if (actor.groupId === null && !actor.uid) return none;
    const taskIds = await findLatestRecapTaskIds(ctx.db, actor.groupId !== null ? { targetThreadId: actor.groupId } : { requesterUid: actor.uid });
    if (!taskIds?.length) return none;
    const overseer = await actor.facts.isTaskOverseer();
    const found = await Promise.all(taskIds.map((id) => findTask(ctx.db, id)));
    const allowed = found
      .filter((task): task is TaskRow => task !== null && task.status === TaskStatus.Proposed)
      .filter((task) => decideTaskRelationship(actor, overseer, { assigner: task.assigner, assignee: task.assignee, sourceThreadId: task.source_thread_id }).canManage);
    if (!allowed.length) return none;
    const deps = taskDeps(ctx);
    const who = taskActorOf(actor);
    const codes: string[] = [];
    for (const task of allowed) {
      try {
        await (confirm ? confirmTask(deps, task, who) : rejectTask(deps, task, who));
        codes.push(shortTaskCode(task));
      } catch (error) {
        // Việc vừa được người khác xác nhận / bỏ giữa chừng (vd «ok V-12» từng mã) — bỏ qua, không chặn các việc còn lại
        if (!(error instanceof TaskActionError)) throw error;
      }
    }
    const outcome: TaskRecapDecisionResult = codes.length ? { outcome: "decided", confirm, codes } : { outcome: "none_left", confirm };
    return executedTask(outcome, null, codes.length ? `${confirm ? "Lưu" : "Bỏ"} ${codes.length} việc recap` : "Không còn đề xuất nào", confirm ? "Lưu đề xuất" : "Bỏ đề xuất");
  },
};

