import { z } from "zod/v4";
import { TaskSource } from "../../constants.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition, type ToolOutcome } from "../tool-definition.js";
import { formatDraftPreviewReply } from "../write/draft-preview-reply.js";
import { executeImmediateWrite } from "../write/immediate-write.js";
import { executeOrDraftWrite, type GuardedTarget } from "../write/own-text-target-guard.js";
import { eraseAction } from "../write/write-action.js";
import { actReply, createdReply, failureReply, listingReply, type TaskActOutcome, type TaskCreatedResult } from "../../tasks/task-command-replies.js";
import { describeTask } from "../../tasks/task-format.js";
import { TASK_TOOL_DECLARATIONS } from "../../tasks/task-tools.js";
import { listTasksForActor, loadTaskForActor, priorityOfText } from "./task-actor-rules.js";
import { TASK_LIST_SCOPES_FOR_TOOLS } from "./task-command-tools.js";
import { taskRelationshipBatchCreate, type TaskRecapSavedResult } from "./task-recap-write-actions.js";
import { taskRelationshipCreate, taskRelationshipUpdate } from "./task-relationship-write-actions.js";
import { taskOutcomeOf } from "./task-write-outcomes.js";

// D-A (20/10/2026): `task_action` hủy / giao lại / dời hạn / ghi chú (báo người khác) chỉ chạy NGAY khi mã V-n nằm trong chữ của chính người hỏi; không thì NHÁP + bản xem
// trước chờ «đồng ý» (own-text-target-guard.ts). Giao việc mới / xong / mở lại / lưu đề xuất từ lời người hỏi giữ ghi ngay.
//
// Công cụ MÔ HÌNH của họ `tasks` (mặt `assistant_model`; tên + khai báo GIỮ NGUYÊN): `list_tasks`, `create_task`, `task_action`, `save_recap_tasks`.
// Cùng lõi với lệnh gõ nhưng trả `{ result: "<câu>" }` y như công cụ cũ — lỗi quyền / trạng thái / không thấy người cũng là câu trả lời, không phải lỗi công cụ.
// Ghi do mô hình khởi xướng GHI NGAY (BC1 bỏ), danh tính từ `ctx.contactActor`. Việc AI tự bắt từ nhóm vẫn là đề xuất chờ «ok V-12» (không đi qua đây).

const createWrite = eraseAction(taskRelationshipCreate);
const updateWrite = eraseAction(taskRelationshipUpdate);
const batchWrite = eraseAction(taskRelationshipBatchCreate);

/**
 * Công cụ MÔ HÌNH chỉ lên khi bot có checklist: đường cũ khai báo chúng khi cấu hình có `tickets` (hàng đợi báo Zalo) và assistant-service chỉ gắn `wakeJobs`
 * vào ngữ cảnh trong trường hợp đó. Thiếu → mô hình không thấy công cụ (như hôm nay); lệnh gõ không bị ảnh hưởng.
 */
const tasksConfigured = (ctx: DataAccessContext): boolean => ctx.contactActor != null && ctx.wakeJobs != null;
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false as const };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false as const };
const modelBase = { surfaces: ["assistant_model"] as const, family: "tasks" as const, assistantErrorShape: "string" as const, available: tasksConfigured };

const declaration = (name: string): string => {
  const found = TASK_TOOL_DECLARATIONS.find((item) => item.name === name);
  if (!found) throw new Error(`thiếu khai báo công cụ việc ${name}`);
  return found.description;
};

const resultOutput = z.object({ result: z.string() });
type Outcome<T> = Promise<ToolOutcome<T> & { entity: string }>;
const asOutcome = <T>(structured: T, summary: string, rowCount = 1) => ({ structured, summary, rowCount, entity: "task" });

/** Lỗi quyền / trạng thái / phân giải → CÂU TRẢ LỜI (công cụ cũ trả `{ result: <câu> }`); lỗi khác ném tiếp. */
function asReply(error: unknown, taskId: number | null): { result: string } {
  if (error instanceof DataAccessError) {
    const reply = failureReply({ code: error.code, message: error.message, reason: error.detail?.reason }, taskId);
    if (reply !== null) return { result: reply };
  }
  throw error;
}

/** Thao tác việc PHÁ HỦY / báo người khác (D-A): cần mã V-n do chính người hỏi nêu mới chạy ngay. */
const GUARDED_TASK_ACTIONS: ReadonlySet<string> = new Set(["cancel", "reassign", "reschedule", "note"]);

/** Chữ trả cho mô hình khi thao tác thành nháp — bản xem trước + mã do MÁY CHỦ gửi (`fixedReply`), mô hình không nhận mã. */
const DRAFT_SENT_RESULT = "Đã tạo nháp và hệ thống đã gửi bản xem trước cho người hỏi. DỪNG: không viết thêm, không báo đã làm; chỉ làm khi người hỏi nhắn «đồng ý».";

const invalid = (message: string) => new DataAccessError("invalid_value", message);

const listTasksTool: ToolDefinition<{ scope?: (typeof TASK_LIST_SCOPES_FOR_TOOLS)[number] }, z.infer<typeof resultOutput>> = {
  ...modelBase, name: "list_tasks", title: "Danh sách việc", description: declaration("list_tasks"),
  input: () => z.object({ scope: z.enum(TASK_LIST_SCOPES_FOR_TOOLS).optional() }), output: resultOutput, annotations: READ,
  async handler(ctx, input): Outcome<z.infer<typeof resultOutput>> {
    const listing = await listTasksForActor(ctx, input.scope ?? "mine");
    return asOutcome({ result: listingReply(listing) }, `${listing.lines.length} việc`, listing.lines.length);
  },
};

const createTaskInput = z.object({
  title: z.string().describe("Việc cần làm, ngắn gọn, bắt đầu bằng động từ"),
  assignee: z.string(),
  due: z.string().optional(),
  priority: z.enum(["Cao", "TB", "Thấp"]).optional(),
});

const createTaskTool: ToolDefinition<z.infer<typeof createTaskInput>, z.infer<typeof resultOutput>> = {
  ...modelBase, name: "create_task", title: "Giao một việc mới", description: declaration("create_task"),
  input: () => createTaskInput, output: resultOutput, annotations: WRITE,
  async handler(ctx, input): Outcome<z.infer<typeof resultOutput>> {
    const title = input.title.trim().slice(0, 300);
    const assignee = input.assignee.trim();
    if (title.length < 3) throw invalid("Thiếu nội dung việc.");
    if (!assignee) throw invalid("Thiếu người làm — hỏi lại người hỏi giao cho ai.");
    try {
      const outcome = taskOutcomeOf<TaskCreatedResult>(await executeImmediateWrite(ctx, createWrite, {
        title, assignee_name: assignee, due_text: input.due?.trim() || undefined, priority: priorityOfText(input.priority), source: TaskSource.Assistant,
      }));
      return asOutcome({ result: createdReply(outcome) }, `Đã giao việc ${outcome.code}`);
    } catch (error) {
      return asOutcome(asReply(error, null), "Không giao được việc", 0);
    }
  },
};

const actionInput = z.object({
  task_id: z.number().int(),
  action: z.enum(["status", "done", "reschedule", "reassign", "cancel", "reopen", "confirm", "reject", "note"]),
  due: z.string().optional(),
  assignee: z.string().optional(),
  note: z.string().optional(),
});

const taskActionTool: ToolDefinition<z.infer<typeof actionInput>, z.infer<typeof resultOutput>> = {
  ...modelBase, name: "task_action", title: "Thao tác một việc", description: declaration("task_action"),
  input: () => actionInput, output: resultOutput, annotations: WRITE, blocksAfterFixedReply: true,
  async handler(ctx, input): Outcome<z.infer<typeof resultOutput>> {
    if (!Number.isSafeInteger(input.task_id) || input.task_id <= 0) throw invalid("Thiếu số việc (V-12 → 12).");
    const note = (input.note ?? "").trim().slice(0, 2000);
    const due = (input.due ?? "").trim();
    const assignee = (input.assignee ?? "").trim();
    if (input.action === "note" && !note) throw invalid("Thiếu nội dung ghi chú.");
    if (input.action === "reschedule" && !due) throw invalid("Thiếu hạn mới (due).");
    if (input.action === "reassign" && !assignee) throw invalid("Thiếu tên người mới (assignee).");
    try {
      if (input.action === "status") {
        const { task } = await loadTaskForActor(ctx, input.task_id);
        return asOutcome({ result: describeTask(task, ctx.now) }, `Việc V-${task.id}`);
      }
      const target: GuardedTarget | null = GUARDED_TASK_ACTIONS.has(input.action) ? { kind: "task", id: input.task_id } : null;
      const written = await executeOrDraftWrite(ctx, updateWrite, {
        task_id: input.task_id, action: input.action, note, due_text: due || undefined, assignee_name: assignee || undefined,
      }, target);
      if (written.kind === "refused") return asOutcome({ result: written.reply }, `Việc V-${input.task_id}: cần xác nhận, không tạo nháp được`, 0);
      if (written.kind === "drafted") {
        return { ...asOutcome({ result: DRAFT_SENT_RESULT }, `Đã tạo nháp thao tác việc V-${input.task_id} chờ «đồng ý»`),
          effects: { fixedReply: formatDraftPreviewReply(written.draft.preview, written.draft.code) } };
      }
      const outcome = taskOutcomeOf<TaskActOutcome>(written.done);
      return asOutcome({ result: actReply(outcome) }, `Việc ${outcome.code}: ${outcome.outcome}`);
    } catch (error) {
      return asOutcome(asReply(error, input.task_id), `Việc V-${input.task_id}: không thực hiện được`, 0);
    }
  },
};

const recapInput = z.object({
  tasks: z.array(z.object({ task: z.string(), owner: z.string().optional(), due: z.string().optional(), priority: z.string().optional() })),
});
const recapOutput = z.object({ saved: z.number(), note: z.string().optional(), tasks: z.array(z.string()).optional(), need_follow_up: z.array(z.string()).optional() });

const saveRecapTool: ToolDefinition<z.infer<typeof recapInput>, z.infer<typeof recapOutput>> = {
  ...modelBase, name: "save_recap_tasks", title: "Lưu việc của recap họp", description: declaration("save_recap_tasks"),
  input: () => recapInput, output: recapOutput, annotations: WRITE,
  async handler(ctx, input): Outcome<z.infer<typeof recapOutput>> {
    const outcome = taskOutcomeOf<TaskRecapSavedResult>(await executeImmediateWrite(ctx, batchWrite, input));
    return asOutcome(outcome, `Đã lưu ${outcome.saved} việc recap`, outcome.saved);
  },
};

export const TASK_MODEL_TOOLS: readonly AnyToolDefinition[] = [eraseTool(listTasksTool), eraseTool(createTaskTool), eraseTool(taskActionTool), eraseTool(saveRecapTool)];
