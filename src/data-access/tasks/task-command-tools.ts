import { z } from "zod/v4";
import type { DataAccessContext } from "../data-access-context.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";
import { executeImmediateWrite } from "../write/immediate-write.js";
import { describeTask } from "../../tasks/task-format.js";
import { shortTaskCode } from "../../tasks/task-repository.js";
import { listTasksForActor, loadTaskForActor } from "./task-actor-rules.js";
import { taskRelationshipCreate, taskRelationshipUpdate, TASK_UPDATE_ACTIONS } from "./task-relationship-write-actions.js";
import { taskRelationshipRecapDecide } from "./task-recap-write-actions.js";
import { taskOutcomeOf } from "./task-write-outcomes.js";
import { eraseAction } from "../write/write-action.js";

// Công cụ LỆNH GÕ của họ `tasks` (mặt `assistant_command` — mô hình không thấy): trả KẾT QUẢ CÓ CẤU TRÚC, lớp lệnh (src/tasks/task-commands.ts) dựng câu
// tiếng Việt y hệt cũ. Chạy NGAY (lệnh gõ = xác nhận); danh tính từ `ctx.contactActor`, không từ tham số. Công cụ mô hình ở task-model-tools.ts.

const createWrite = eraseAction(taskRelationshipCreate);
const updateWrite = eraseAction(taskRelationshipUpdate);
const recapWrite = eraseAction(taskRelationshipRecapDecide);

export const TASK_LIST_SCOPES_FOR_TOOLS = ["mine", "group", "overdue", "proposed"] as const;
const hasActor = (ctx: DataAccessContext): boolean => ctx.contactActor != null;
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false as const };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false as const };

const listInput = z.object({ scope: z.enum(TASK_LIST_SCOPES_FOR_TOOLS) }).strict();
const taskIdInput = z.object({ task_id: z.number().int().positive() }).strict();
const createInput = z.object({
  title: z.string().min(1), assignee_name: z.string().min(1), due_text: z.string().optional(),
  priority: z.number().int().min(1).max(3).optional(), source: z.number().int().min(1).max(4).optional(),
}).strict();
const actInput = z.object({
  task_id: z.number().int().positive(), action: z.enum(TASK_UPDATE_ACTIONS), note: z.string().optional(), due_text: z.string().optional(), assignee_name: z.string().optional(),
}).strict();
const recapInput = z.object({ decision: z.enum(["confirm", "reject"]) }).strict();

const listOutput = z.object({ scope: z.enum(TASK_LIST_SCOPES_FOR_TOOLS), in_group: z.boolean(), lines: z.array(z.string()), first_code: z.string().nullable() });
const getOutput = z.object({ task_id: z.number(), code: z.string(), description: z.string() });
/** Kết quả ghi: hình chung cho mọi `outcome` (xem tasks/task-command-replies.ts); trường không liên quan để trống. */
export const taskWriteOutput = z.object({
  outcome: z.string(), code: z.string().optional(), title: z.string().optional(), assignee_name: z.string().optional(), due_label: z.string().optional(),
  has_due: z.boolean().optional(), notified: z.boolean().optional(), notified_name: z.string().nullable().optional(), confirm: z.boolean().optional(),
  codes: z.array(z.string()).optional(),
});

type Outcome<T> = Promise<{ structured: T; summary: string; rowCount: number; entity: string }>;
const asOutcome = <T>(structured: T, summary: string, rowCount = 1) => ({ structured, summary, rowCount, entity: "task" });

const commandBase = { surfaces: ["assistant_command"] as const, family: "tasks" as const, available: hasActor };

const listForActor: ToolDefinition<z.infer<typeof listInput>, z.infer<typeof listOutput>> = {
  ...commandBase, name: "task_list_for_actor", title: "Danh sách việc của người đang nhắn (lệnh «việc»)",
  description: "Việc theo phạm vi (mine / group / overdue / proposed) và quyền của người đang nhắn: «sếp» / hỏi trong nhóm thấy việc của mọi người, người khác chỉ việc mình. Chỉ lệnh gõ.",
  input: () => listInput, output: listOutput, annotations: READ,
  async handler(ctx, input): Outcome<z.infer<typeof listOutput>> {
    const listing = await listTasksForActor(ctx, input.scope);
    return asOutcome(listing, `${listing.lines.length} việc`, listing.lines.length);
  },
};

const getTask: ToolDefinition<z.infer<typeof taskIdInput>, z.infer<typeof getOutput>> = {
  ...commandBase, name: "task_get", title: "Xem một việc (lệnh «V-12»)",
  description: "Chi tiết một việc theo luật quan hệ (người giao / phụ trách / sếp; trong nhóm chỉ việc của nhóm). Chỉ lệnh gõ.",
  input: () => taskIdInput, output: getOutput, annotations: READ,
  async handler(ctx, input): Outcome<z.infer<typeof getOutput>> {
    const { task } = await loadTaskForActor(ctx, input.task_id);
    return asOutcome({ task_id: task.id, code: shortTaskCode(task), description: describeTask(task, ctx.now) }, `Việc ${task.code}`);
  },
};

const createCommand: ToolDefinition<z.infer<typeof createInput>, z.infer<typeof taskWriteOutput>> = {
  ...commandBase, name: "task_create", title: "Giao việc mới (lệnh «giao Minh: …»)",
  description: "Giao việc mới theo tên người làm + hạn chữ; chạy ngay (lệnh gõ = xác nhận). Chỉ lệnh gõ.",
  input: () => createInput, output: taskWriteOutput, annotations: WRITE,
  async handler(ctx, input): Outcome<z.infer<typeof taskWriteOutput>> {
    const outcome = taskOutcomeOf<z.infer<typeof taskWriteOutput>>(await executeImmediateWrite(ctx, createWrite, input));
    return asOutcome(outcome, `Đã giao việc ${outcome.code}`);
  },
};

const actCommand: ToolDefinition<z.infer<typeof actInput>, z.infer<typeof taskWriteOutput>> = {
  ...commandBase, name: "task_act", title: "Thao tác việc (lệnh «xong / dời / giao lại / hủy / mở lại / ok / bỏ V-12»)",
  description: "Báo xong / ghi chú / dời hạn / giao lại / hủy / mở lại / lưu hoặc bỏ đề xuất MỘT việc theo luật quan hệ; chạy ngay. Chỉ lệnh gõ.",
  input: () => actInput, output: taskWriteOutput, annotations: WRITE,
  async handler(ctx, input): Outcome<z.infer<typeof taskWriteOutput>> {
    const outcome = taskOutcomeOf<z.infer<typeof taskWriteOutput>>(await executeImmediateWrite(ctx, updateWrite, input));
    return asOutcome(outcome, `Việc ${outcome.code}: ${outcome.outcome}`);
  },
};

const recapCommand: ToolDefinition<z.infer<typeof recapInput>, z.infer<typeof taskWriteOutput>> = {
  ...commandBase, name: "task_confirm_latest_recap", title: "Lưu / bỏ cả loạt việc của recap gần nhất (lệnh «ok hết» / «bỏ hết»)",
  description: "Lưu (confirm) hoặc bỏ (reject) mọi đề xuất việc của recap họp tự động gần nhất gửi vào cuộc này; không có recap nào khớp thì outcome none. Chỉ lệnh gõ.",
  input: () => recapInput, output: taskWriteOutput, annotations: WRITE,
  async handler(ctx, input): Outcome<z.infer<typeof taskWriteOutput>> {
    const outcome = taskOutcomeOf<z.infer<typeof taskWriteOutput>>(await executeImmediateWrite(ctx, recapWrite, input));
    return asOutcome(outcome, `Recap: ${outcome.outcome}`, outcome.codes?.length ?? 0);
  },
};

export const TASK_COMMAND_TOOLS: readonly AnyToolDefinition[] = [
  eraseTool(listForActor), eraseTool(getTask), eraseTool(createCommand), eraseTool(actCommand), eraseTool(recapCommand),
];

/** Tên công cụ lệnh — lớp lệnh kiểm máy chủ liệt kê đủ trước khi dùng đường MCP. */
export const TASK_COMMAND_TOOL_NAMES = ["task_list_for_actor", "task_get", "task_create", "task_act", "task_confirm_latest_recap"] as const;
