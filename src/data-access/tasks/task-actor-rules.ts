import { ContactKind, TaskPriority, TaskStatus } from "../../constants.js";
import { decideTaskRelationship, type TaskRelationDecision } from "../actors/contact-relationship-rules.js";
import type { ContactActor } from "../actors/contact-actor.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { sourceThreadVisibilitySql } from "../visibility-guards.js";
import { LIST_LIMIT, type TaskListingResult } from "../../tasks/task-command-replies.js";
import type { TaskListScope } from "../../tasks/task-command-parser.js";
import { describeTaskLine } from "../../tasks/task-format.js";
import { findTask, isTaskVisible, listTasks, shortTaskCode, type TaskRow } from "../../tasks/task-repository.js";
import type { SqlPart } from "../../web/api/list-query.js";

// Luật việc của liên hệ Zalo, phần HỎI DỮ LIỆU (quyết định thuần nằm ở actors/contact-relationship-rules.ts `decideTaskRelationship`): ai là «sếp»,
// việc nào người này thấy (nhóm nguồn + Mật), nạp việc kèm quyết định. Chép đúng `runTaskCommand` cũ (src/tasks/task-commands-legacy.ts) — test vàng
// (test/assistant-mcp-tasks.integration.test.ts) so câu trả lời cũ / mới trên ma trận vai × quan hệ × thao tác × tin riêng / nhóm.

export const TASK_ACTOR_REQUIRED = "Thao tác việc cần người đang nhắn bot trên Zalo.";

/** Độ ưu tiên người gõ / mô hình truyền chữ («Cao», «TB», «trung bình», «Thấp»); không nhận ra → mặc định của task-service. */
const PRIORITY_WORDS: Record<string, TaskPriority> = { cao: TaskPriority.High, tb: TaskPriority.Normal, "trung bình": TaskPriority.Normal, thấp: TaskPriority.Low };
export function priorityOfText(text: unknown): TaskPriority | undefined {
  const word = String(text ?? "").toLowerCase();
  // Khóa từ mô hình: không tra qua prototype («constructor», «__proto__», «toString»…)
  return Object.hasOwn(PRIORITY_WORDS, word) ? PRIORITY_WORDS[word] : undefined;
}

/** Chủ thể của lượt; thiếu = lời gọi không đến từ tin Zalo (HTTP không bao giờ có). */
export function requireTaskActor(ctx: DataAccessContext): ContactActor {
  if (!ctx.contactActor) throw new DataAccessError("forbidden", TASK_ACTOR_REQUIRED);
  return ctx.contactActor;
}

/** Lỗi quyền kèm `reason` máy đọc được; lớp lệnh dựng đúng câu cũ (`failureReply` ở tasks/task-command-replies.ts). */
export const denyTask = (reason: "not_found" | "staff_only" | "work_done" | "work_note" | "manage_only", detail = ""): DataAccessError =>
  new DataAccessError("not_allowed", `Không đủ quyền với việc${detail ? ` ${detail}` : ""} (${reason}).`, undefined, { reason });

/**
 * Điều kiện nhóm nguồn khi «sếp» xem việc của người khác Ở TIN RIÊNG (bảng `task t` + LEFT JOIN `zalo_group g`; trong nhóm đã khóa theo nhóm). Tài khoản
 * web (và đã tắt) đi qua luật nhóm + Mật của lõi; người chỉ suy từ vai trò / người nhận giữ phạm vi «mọi nhóm» nhưng KHÔNG thấy việc của nhóm Mật.
 */
export function overseerVisibilityPart(ctx: DataAccessContext, actor: ContactActor): SqlPart | undefined {
  if (actor.groupId !== null) return undefined;
  if (actor.origin === "web_user" || actor.origin === "disabled_account") return sourceThreadVisibilitySql(ctx, "t.source_thread_id", "g");
  return ctx.includeConfidential ? undefined : { sql: "(g.id IS NULL OR g.is_confidential = 0)", params: [] };
}

/**
 * Giao việc: nhân sự công ty hoặc «sếp» (cổng tin riêng cho lệnh việc qua với mọi người để người phụ trách báo xong). Tài khoản web đã TẮT thì không
 * giao được dù liên hệ là nhân sự (L7): người đã bị thu hồi quyền vào hệ thống không được giao việc qua Zalo.
 */
export async function assertMayAssign(actor: ContactActor): Promise<void> {
  if (actor.origin === "disabled_account") throw denyTask("staff_only");
  if (!(await actor.facts.isTaskOverseer()) && actor.contactKind !== ContactKind.Staff) throw denyTask("staff_only");
}

/** Danh sách theo `scope` — «sếp» / hỏi trong nhóm thấy việc của mọi người, người khác chỉ việc mình phụ trách hoặc đã giao. */
export async function listTasksForActor(ctx: DataAccessContext, scope: TaskListScope): Promise<TaskListingResult> {
  const actor = requireTaskActor(ctx);
  const inGroup = actor.groupId !== null;
  const overseer = await actor.facts.isTaskOverseer();
  const everyone = overseer || inGroup;
  const filter = {
    statuses: scope === "proposed" ? [TaskStatus.Proposed] : [TaskStatus.Open],
    threadId: actor.groupId ?? undefined,
    involvingUid: scope === "mine" || !everyone ? actor.uid : undefined,
    overdueAt: scope === "overdue" ? ctx.now : undefined,
  };
  // «Sếp» xem việc của mọi người ở tin riêng: bỏ việc nhóm Mật (trừ khi có quyền Mật) và việc ngoài phạm vi nhóm của tài khoản
  const visibility = everyone && scope !== "mine" && overseer ? overseerVisibilityPart(ctx, actor) : undefined;
  const tasks = await listTasks(ctx.db, { ...filter, visibility, limit: LIST_LIMIT });
  return { scope, in_group: inGroup, lines: tasks.map((task) => describeTaskLine(task, ctx.now)), first_code: tasks[0] ? shortTaskCode(tasks[0]) : null };
}

export interface TaskTarget {
  task: TaskRow;
  decision: TaskRelationDecision;
}

/**
 * Nạp việc + quyết định quan hệ. Không có / không thấy (việc của người khác, ngoài nhóm, nhóm Mật) → `not_allowed` lý do `not_found` — không lộ
 * «có mà không được xem». Quyền làm / quản lý từng thao tác do nơi gọi kiểm bằng `decision` (câu từ chối khác nhau theo thao tác).
 */
export async function loadTaskForActor(ctx: DataAccessContext, taskId: number): Promise<TaskTarget> {
  const actor = requireTaskActor(ctx);
  const task = await findTask(ctx.db, taskId);
  if (!task) throw denyTask("not_found", `V-${taskId}`);
  const overseer = await actor.facts.isTaskOverseer();
  const decision = decideTaskRelationship(actor, overseer, { assigner: task.assigner, assignee: task.assignee, sourceThreadId: task.source_thread_id });
  if (!decision.canView) throw denyTask("not_found", `V-${taskId}`);
  // Xem việc người khác chỉ nhờ vai trò «sếp» → cùng luật phạm vi / Mật với danh sách
  if (!decision.isAssigner && !decision.isAssignee && !(await isTaskVisible(ctx.db, task.id, overseerVisibilityPart(ctx, actor)))) throw denyTask("not_found", `V-${taskId}`);
  return { task, decision };
}
