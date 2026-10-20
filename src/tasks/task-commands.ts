import { openMcpTurn } from "../assistant/mcp-bridge/open-mcp-turn.js";
import { resolveAssistantMcpBridge } from "../assistant/mcp-bridge/assistant-mcp-bridge-config.js";
import type { AssistantMcpTurn } from "../assistant/mcp-bridge/assistant-mcp-turn.js";
import type { CallToolResultLike } from "../assistant/mcp-bridge/mcp-call-result-mapper.js";
import { ERROR_META_KEY } from "../mcp/mcp-meta-keys.js";
import {
  actReply, createdReply, failureReply, listingReply, recapDecisionReply, type TaskActOutcome, type TaskCreatedResult, type TaskListingResult,
  type TaskRecapDecisionResult, type TaskToolFailure,
} from "./task-command-replies.js";
import type { TaskCommand } from "./task-command-parser.js";
import { runTaskCommandLegacy, type TaskCommandContext } from "./task-commands-legacy.js";

// Lệnh việc gõ trên Zalo (đọc ở src/assistant/chat-commands.ts), định tuyến theo họ `tasks`: họ BẬT → gọi công cụ lệnh của máy chủ MCP trong tiến trình
// (mặt `assistant_command`; luật quyền ở lõi `data-access/tasks/`) rồi dựng câu từ kết quả có cấu trúc (task-command-replies.ts); họ TẮT → đường cũ
// task-commands-legacy.ts. Lệnh gõ chạy NGAY (lệnh gõ = xác nhận). Thông báo Zalo (gửi thật) vẫn đi qua hàng việc nền.

export { buildTaskContext, resolveAssignee, type TaskCommandContext } from "./task-commands-legacy.js";

const COMMAND_TOOLS = ["task_list_for_actor", "task_get", "task_create", "task_act", "task_confirm_latest_recap"] as const;
type CommandTool = (typeof COMMAND_TOOLS)[number];

interface CommandSession {
  turn: AssistantMcpTurn;
  /** Phiên do chính lệnh này mở (không có `ctx.mcp`) → phải đóng. */
  owned: boolean;
}

/** Phiên lệnh nếu họ `tasks` bật và máy chủ liệt kê đủ công cụ lệnh; không thì undefined (đường cũ). */
async function openSession(ctx: TaskCommandContext): Promise<CommandSession | undefined> {
  let session: CommandSession | undefined;
  if (ctx.mcp) {
    const turn = await ctx.mcp();
    session = turn ? { turn, owned: false } : undefined;
  } else if (ctx.access) {
    const access = await ctx.access();
    // Cuộc + tin của lệnh này đi vào chủ thể (nơi gọi có thể phân giải ngữ cảnh mà không kèm cuộc): việc mới gắn / báo lại đúng chỗ cần chúng
    const contactActor = access.contactActor && { ...access.contactActor, threadId: ctx.threadId, messageId: ctx.messageId, groupId: ctx.groupId };
    const turn = openMcpTurn({ ...access, contactActor }, resolveAssistantMcpBridge(undefined), { groupScopeId: ctx.groupId ?? undefined, wakeJobs: ctx.deps.wakeJobs });
    session = turn ? { turn, owned: true } : undefined;
  }
  if (!session?.turn.familyEnabled("tasks")) return await discard(session);
  const listed = await session.turn.command();
  return listed && COMMAND_TOOLS.every((name) => listed.toolNames.has(name)) ? session : await discard(session);
}

async function discard(session: CommandSession | undefined): Promise<undefined> {
  if (session?.owned) await session.turn.close();
  return undefined;
}

/** Gọi một công cụ lệnh; lỗi nghiệp vụ → câu bot, lỗi hệ thống (không phải của luật việc) ném tiếp như đường cũ. */
async function callCommandTool(turn: AssistantMcpTurn, name: CommandTool, args: Record<string, unknown>, taskId: number | null):
  Promise<{ reply: string } | { structured: Record<string, unknown> }> {
  const result: CallToolResultLike = await turn.callTool("assistant_command", name, args);
  if (result.isError || !result.structuredContent) {
    const meta = (result._meta as Record<string, unknown> | undefined)?.[ERROR_META_KEY] as TaskToolFailure | undefined;
    const reply = meta ? failureReply(meta, taskId) : null;
    if (reply !== null) return { reply };
    throw new Error(`lệnh việc qua MCP lỗi (${name}): ${meta?.message ?? "không rõ"}`);
  }
  return { structured: result.structuredContent as Record<string, unknown> };
}

/** Lệnh gõ → (công cụ, tham số). Số việc 0 («V-0») không có thật: nơi gọi trả câu «không thấy», khỏi gọi công cụ. */
function toolCall(command: TaskCommand): { name: CommandTool; args: Record<string, unknown> } {
  switch (command.kind) {
    case "task_list": return { name: "task_list_for_actor", args: { scope: command.scope } };
    case "task_status": return { name: "task_get", args: { task_id: command.taskId } };
    case "task_create":
      return { name: "task_create", args: { title: command.title, assignee_name: command.assigneeName, due_text: command.dueText || undefined, priority: command.priority, source: command.source } };
    case "task_confirm_recap": return { name: "task_confirm_latest_recap", args: { decision: "confirm" } };
    case "task_reject_recap": return { name: "task_confirm_latest_recap", args: { decision: "reject" } };
    case "task_done": return { name: "task_act", args: { task_id: command.taskId, action: "done", note: command.note } };
    case "task_note": return { name: "task_act", args: { task_id: command.taskId, action: "note", note: command.note } };
    case "task_reschedule": return { name: "task_act", args: { task_id: command.taskId, action: "reschedule", due_text: command.dueText } };
    case "task_reassign": return { name: "task_act", args: { task_id: command.taskId, action: "reassign", assignee_name: command.assigneeName } };
    case "task_cancel": return { name: "task_act", args: { task_id: command.taskId, action: "cancel", note: command.note } };
    case "task_reopen": return { name: "task_act", args: { task_id: command.taskId, action: "reopen", note: command.note } };
    case "task_confirm": return { name: "task_act", args: { task_id: command.taskId, action: "confirm" } };
    case "task_reject": return { name: "task_act", args: { task_id: command.taskId, action: "reject" } };
  }
}

async function runViaMcp(turn: AssistantMcpTurn, command: TaskCommand): Promise<string | null> {
  const taskId = "taskId" in command ? command.taskId : null;
  if (taskId !== null && taskId <= 0) return failureReply({ code: "not_allowed", message: "", reason: "not_found" }, taskId) ?? "";
  const { name, args } = toolCall(command);
  const called = await callCommandTool(turn, name, args, taskId);
  if ("reply" in called) return called.reply;
  const data = called.structured;
  switch (command.kind) {
    case "task_list": return listingReply(data as unknown as TaskListingResult);
    case "task_status": return String(data.description);
    case "task_create": return createdReply(data as unknown as TaskCreatedResult);
    case "task_confirm_recap":
    case "task_reject_recap": return recapDecisionReply(data as unknown as TaskRecapDecisionResult);
    default: return actReply(data as unknown as TaskActOutcome);
  }
}

/** Câu trả lời; null = không phải việc của bot («ok hết» không khớp recap nào) — nơi gọi để AI trả lời như câu thường. */
export async function runTaskCommand(ctx: TaskCommandContext, command: TaskCommand, now: Date): Promise<string | null> {
  const session = await openSession(ctx);
  if (!session) return runTaskCommandLegacy(ctx, command, now);
  try {
    return await runViaMcp(session.turn, command);
  } finally {
    if (session.owned) await session.turn.close();
  }
}
