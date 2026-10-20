import { openMcpTurn } from "../assistant/mcp-bridge/open-mcp-turn.js";
import { resolveAssistantMcpBridge } from "../assistant/mcp-bridge/assistant-mcp-bridge-config.js";
import type { AssistantMcpTurn } from "../assistant/mcp-bridge/assistant-mcp-turn.js";
import type { CallToolResultLike } from "../assistant/mcp-bridge/mcp-call-result-mapper.js";
import { ERROR_META_KEY } from "../mcp/mcp-meta-keys.js";
import {
  actReply, createdReply, failureReply, listingReply, type TicketActOutcome, type TicketCreatedResult, type TicketListingResult, type TicketToolFailure,
} from "./ticket-command-replies.js";
import { runTicketCommandLegacy, type TicketCommand, type TicketCommandContext } from "./ticket-commands-legacy.js";

// Lệnh ticket gõ trên Zalo (đọc ở src/assistant/chat-commands.ts), định tuyến theo họ `tickets`: họ BẬT → gọi công cụ lệnh của máy chủ MCP trong
// tiến trình (mặt `assistant_command`; luật quyền ở lõi `data-access/tickets/`) rồi dựng câu từ kết quả có cấu trúc (ticket-command-replies.ts);
// họ TẮT → đường cũ ticket-commands-legacy.ts. Lệnh gõ chạy NGAY (lệnh gõ = xác nhận). Thông báo Zalo (gửi thật) vẫn đi qua hàng việc nền.

export { buildTicketContext, isOpenTicket, type TicketCommand, type TicketCommandContext } from "./ticket-commands-legacy.js";

const COMMAND_TOOLS = ["ticket_list_for_actor", "ticket_get", "ticket_create", "ticket_act"] as const;
const ACT_ACTION = { ticket_accept: "accept", ticket_done: "done", ticket_cancel: "cancel", ticket_note: "note" } as const;

interface CommandSession {
  turn: AssistantMcpTurn;
  /** Phiên do chính lệnh này mở (không có `ctx.mcp`) → phải đóng. */
  owned: boolean;
}

/** Phiên lệnh nếu họ `tickets` bật và máy chủ liệt kê đủ công cụ lệnh; không thì undefined (đường cũ). */
async function openSession(ctx: TicketCommandContext): Promise<CommandSession | undefined> {
  let session: CommandSession | undefined;
  if (ctx.mcp) {
    const turn = await ctx.mcp();
    session = turn ? { turn, owned: false } : undefined;
  } else if (ctx.access) {
    const access = await ctx.access();
    // Cuộc + tin của lệnh này đi vào chủ thể (nơi gọi có thể phân giải ngữ cảnh mà không kèm cuộc): việc gắn ảnh / báo lại đúng chỗ cần chúng
    const contactActor = access.contactActor && { ...access.contactActor, threadId: ctx.threadId, messageId: ctx.messageId, botAccountId: ctx.botAccountId, groupId: ctx.scopeGroupId ?? null };
    const turn = openMcpTurn({ ...access, contactActor }, resolveAssistantMcpBridge(undefined), { groupScopeId: ctx.scopeGroupId, wakeJobs: ctx.deps.wakeJobs });
    session = turn ? { turn, owned: true } : undefined;
  }
  if (!session?.turn.familyEnabled("tickets")) return await discard(session);
  const listed = await session.turn.command();
  return listed && COMMAND_TOOLS.every((name) => listed.toolNames.has(name)) ? session : await discard(session);
}

async function discard(session: CommandSession | undefined): Promise<undefined> {
  if (session?.owned) await session.turn.close();
  return undefined;
}

/** Gọi một công cụ lệnh; lỗi nghiệp vụ → câu bot, lỗi hệ thống (không phải của luật ticket) ném tiếp như đường cũ. */
async function callCommandTool(turn: AssistantMcpTurn, name: (typeof COMMAND_TOOLS)[number], args: Record<string, unknown>, ticketId: number | null):
  Promise<{ reply: string } | { structured: Record<string, unknown> }> {
  const result: CallToolResultLike = await turn.callTool("assistant_command", name, args);
  if (result.isError || !result.structuredContent) {
    const meta = (result._meta as Record<string, unknown> | undefined)?.[ERROR_META_KEY] as TicketToolFailure | undefined;
    const reply = meta ? failureReply(meta, ticketId) : null;
    if (reply !== null) return { reply };
    throw new Error(`lệnh ticket qua MCP lỗi (${name}): ${meta?.message ?? "không rõ"}`);
  }
  return { structured: result.structuredContent as Record<string, unknown> };
}

async function runViaMcp(ctx: TicketCommandContext, turn: AssistantMcpTurn, command: TicketCommand): Promise<string> {
  // Số ticket 0 («T-0») không có thật: cùng câu «không thấy» như đường cũ, khỏi gọi công cụ
  const ticketId = "ticketId" in command ? command.ticketId : null;
  if (ticketId !== null && ticketId <= 0) return failureReply({ code: "not_allowed", message: "", reason: "not_found" }, ticketId) ?? "";
  let called: Awaited<ReturnType<typeof callCommandTool>>;
  if (command.kind === "ticket_create") called = await callCommandTool(turn, "ticket_create", { text: command.text }, null);
  else if (command.kind === "ticket_list") called = await callCommandTool(turn, "ticket_list_for_actor", {}, null);
  else if (command.kind === "ticket_status") called = await callCommandTool(turn, "ticket_get", { ticket_id: command.ticketId }, command.ticketId);
  else called = await callCommandTool(turn, "ticket_act", { ticket_id: command.ticketId, action: ACT_ACTION[command.kind], note: "note" in command ? command.note : undefined }, command.ticketId);
  if ("reply" in called) return called.reply;
  const data = called.structured;
  // Tệp đưa về hàng tải: bộ tải ở lớp ngoài (lõi chỉ gom id), chuyển đúng như ticket-service cũ gọi `requestDownload`
  const downloads = data.download_ids as number[] | undefined;
  if (downloads?.length) ctx.deps.requestDownload?.(downloads);
  switch (command.kind) {
    case "ticket_create": return createdReply(data as unknown as TicketCreatedResult);
    case "ticket_list": return listingReply(data as unknown as TicketListingResult);
    case "ticket_status": return String(data.description);
    default: return actReply(data as unknown as TicketActOutcome);
  }
}

export async function runTicketCommand(ctx: TicketCommandContext, command: TicketCommand, now: Date): Promise<string> {
  const session = await openSession(ctx);
  if (!session) return runTicketCommandLegacy(ctx, command, now);
  try {
    return await runViaMcp(ctx, session.turn, command);
  } finally {
    if (session.owned) await session.turn.close();
  }
}
