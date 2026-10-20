import { z } from "zod/v4";
import { createDraft } from "../../send-commands/send-command-draft-service.js";
import { NOT_ALLOWED_REPLY } from "../../send-commands/send-command-replies.js";
import { PROPOSE_REMINDER_DECLARATION, PROPOSE_SEND_DECLARATION } from "../../send-commands/send-tool-declarations.js";
import { createPinDraft } from "../../send-commands/send-pin-draft-service.js";
import { createReminderDraft } from "../../send-commands/send-reminder-draft-service.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";
import { hasSendTurn, isSendAllowedNow, requireSendRequester, sendDepsOf, sendQuestionOf, sendSourceOf } from "./send-requester-facts.js";

// Công cụ TẠO NHÁP của họ `send` — vào kho nháp riêng `send_command` (mã G-…, màn web, chặn sửa chữ), KHÔNG vào `mcp_write_draft`. Mọi luật (quyền, trần nháp /
// giờ, phân giải nơi nhận, nguyên văn, xem trước) nằm trong dịch vụ cũ `createDraft` / `createReminderDraft` / `createPinDraft` — ở đây chỉ nối danh tính từ `contactActor`.
// Mặt `assistant_model` (tên + khai báo GIỮ NGUYÊN): `propose_send_message`, `propose_group_reminder` — nguyên văn tin lấy từ sổ lượt (không từ tham số mô hình),
// bản xem trước đi qua `effects.fixedReply`. Mặt `assistant_command` (chỉ mã phía trợ lý gọi): `send_draft_create` (lệnh gõ + lời mời họp do máy chủ dựng),
// `send_pin_draft_create`. Công cụ KHÔNG có mặt `mcp_http` (quyết định 9: gửi Zalo qua MCP ngoài ngoài phạm vi).

const NOTE_NOT_DRAFTED = "Chưa tạo nháp — hệ thống đã báo lý do cho người dùng. Không viết thêm gì.";
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false as const };
const replyOutput = z.object({ reply: z.string(), command_id: z.number().optional() });
const draftedOutput = z.object({ drafted: z.boolean(), note: z.string() });
type Reply = z.infer<typeof replyOutput>;
type Drafted = z.infer<typeof draftedOutput>;
type SendOutcome<T> = Promise<{ structured: T; summary: string; rowCount: number; entity: string; effects?: { fixedReply: string } }>;

const describe = (declaration: { parameters?: unknown }, property: string): string =>
  ((declaration.parameters as { properties: Record<string, { description: string }> }).properties[property]).description;

/** Người ra lệnh đủ quyền + cuộc nguồn, hoặc ném (công cụ mô hình đã ẩn khi không đủ quyền — đây là lớp chặn thứ hai). */
async function requester(ctx: DataAccessContext) {
  const who = await requireSendRequester(ctx);
  if (!who) throw new DataAccessError("forbidden", NOT_ALLOWED_REPLY);
  return who;
}

function sourceFor(ctx: DataAccessContext, threadId: number) {
  const source = sendSourceOf(ctx);
  return { requesterContactId: source.contactId, sourceThreadId: threadId, sourceMessageId: source.messageId, botAccountId: source.botAccountId };
}

const asReply = (result: { reply: string; commandId?: number }, summary: string) =>
  ({ structured: { reply: result.reply, ...(result.commandId !== undefined ? { command_id: result.commandId } : {}) }, summary, rowCount: result.commandId ? 1 : 0, entity: "send_command" });

// ------------------------------------------------------------------ mặt lệnh gõ / phía trợ lý

const commandBase = { surfaces: ["assistant_command"] as const, family: "send" as const, available: hasSendTurn, annotations: WRITE, output: replyOutput };

const createInput = z.object({
  question: z.string(), target_names: z.array(z.string()), schedule_text: z.string(), body: z.string(), with_recent_files: z.boolean(),
  /** true = `body` do MÁY CHỦ dựng (lời mời họp từ Calendar) — chỉ mã phía trợ lý đặt được; mô hình không có đường tới công cụ này. */
  trusted_body: z.boolean().optional(),
}).strict();

const sendDraftCreate: ToolDefinition<z.infer<typeof createInput>, Reply> = {
  ...commandBase, name: "send_draft_create", title: "Tạo nháp lệnh gửi tin (lệnh «gửi nhóm A: …»)",
  description: "Tạo NHÁP lệnh gửi tin Zalo từ lệnh gõ của người hỏi; trả bản xem trước hoặc lý do không tạo. Chỉ lệnh gõ / mã phía trợ lý.",
  input: () => createInput,
  async handler(ctx, input): SendOutcome<Reply> {
    const who = await requireSendRequester(ctx);
    if (!who) return asReply({ reply: NOT_ALLOWED_REPLY }, "Không đủ quyền ra lệnh gửi");
    const result = await createDraft(sendDepsOf(ctx), {
      requester: who.requester, ...sourceFor(ctx, who.threadId), question: input.question, targetNames: input.target_names, scheduleText: input.schedule_text,
      body: input.body, trustedBody: input.trusted_body, withRecentFiles: input.with_recent_files,
    }, ctx.now);
    return asReply(result, result.commandId ? `Nháp G-${result.commandId}` : "Chưa tạo nháp");
  },
};

const pinInput = z.object({ question: z.string(), group_names: z.array(z.string()), content: z.string() }).strict();

const sendPinDraftCreate: ToolDefinition<z.infer<typeof pinInput>, Reply> = {
  ...commandBase, name: "send_pin_draft_create", title: "Tạo nháp ghim lên nhóm",
  description: "Tạo NHÁP ghim ghi chú lên nhóm (nội dung do mã phía trợ lý dựng từ cuộc họp hoặc mô hình soạn); trả bản xem trước. Chỉ mã phía trợ lý.",
  input: () => pinInput,
  async handler(ctx, input): SendOutcome<Reply> {
    const who = await requireSendRequester(ctx);
    if (!who) return asReply({ reply: NOT_ALLOWED_REPLY }, "Không đủ quyền ra lệnh gửi");
    const result = await createPinDraft(sendDepsOf(ctx), {
      requester: who.requester, ...sourceFor(ctx, who.threadId), question: input.question, groupNames: input.group_names, content: input.content,
    }, ctx.now);
    return asReply(result, result.commandId ? `Nháp ghim G-${result.commandId}` : "Chưa tạo nháp");
  },
};

// ------------------------------------------------------------------ mặt mô hình (tên + khai báo giữ nguyên)

const modelBase = {
  surfaces: ["assistant_model"] as const, family: "send" as const, assistantErrorShape: "string" as const, blocksAfterFixedReply: true, annotations: WRITE,
  output: draftedOutput, available: (ctx: DataAccessContext) => hasSendTurn(ctx) && isSendAllowedNow(ctx),
};

const proposeSendInput = z.object({
  targets: z.array(z.string()).describe(describe(PROPOSE_SEND_DECLARATION, "targets")),
  content: z.string().describe(describe(PROPOSE_SEND_DECLARATION, "content")),
  schedule: z.string().optional().describe(describe(PROPOSE_SEND_DECLARATION, "schedule")),
  with_recent_files: z.boolean().optional().describe(describe(PROPOSE_SEND_DECLARATION, "with_recent_files")),
});

/** Phản hồi cho mô hình + câu dựng sẵn của lượt (bản xem trước / lý do từ chối do máy chủ dựng). */
function drafted(result: { reply: string; commandId?: number }, doneNote: string): Awaited<SendOutcome<Drafted>> {
  const structured = result.commandId ? { drafted: true, note: doneNote } : { drafted: false, note: NOTE_NOT_DRAFTED };
  return { structured, summary: structured.drafted ? `Nháp G-${result.commandId}` : "Chưa tạo nháp", rowCount: result.commandId ? 1 : 0, entity: "send_command", effects: { fixedReply: result.reply } };
}

const proposeSendMessage: ToolDefinition<z.infer<typeof proposeSendInput>, Drafted> = {
  ...modelBase, name: "propose_send_message", title: "Đề xuất gửi tin (nháp G-…)", description: PROPOSE_SEND_DECLARATION.description,
  input: () => proposeSendInput,
  async handler(ctx, input): SendOutcome<Drafted> {
    const who = await requester(ctx);
    if (!input.targets.length || (!input.content.trim() && input.with_recent_files !== true)) {
      throw new DataAccessError("invalid_value", "Thiếu nơi nhận (targets) hoặc nội dung (content).");
    }
    const result = await createDraft(sendDepsOf(ctx), {
      requester: who.requester, ...sourceFor(ctx, who.threadId), question: sendQuestionOf(ctx), targetNames: input.targets, scheduleText: input.schedule ?? "",
      body: input.content, withRecentFiles: input.with_recent_files === true,
    }, ctx.now);
    return drafted(result, "Đã tạo nháp và gửi bản xem trước cho người dùng; họ nhắn «đồng ý» mới gửi. Không viết thêm gì.");
  },
};

const proposeReminderInput = z.object({
  groups: z.array(z.string()).describe(describe(PROPOSE_REMINDER_DECLARATION, "groups")),
  title: z.string().describe(describe(PROPOSE_REMINDER_DECLARATION, "title")),
  start_time: z.string().describe(describe(PROPOSE_REMINDER_DECLARATION, "start_time")),
  repeat: z.enum(["none", "daily", "weekly", "monthly"]).optional().describe(describe(PROPOSE_REMINDER_DECLARATION, "repeat")),
});

const proposeGroupReminder: ToolDefinition<z.infer<typeof proposeReminderInput>, Drafted> = {
  ...modelBase, name: "propose_group_reminder", title: "Đề xuất nhắc hẹn cho nhóm (nháp G-…)", description: PROPOSE_REMINDER_DECLARATION.description,
  input: () => proposeReminderInput,
  async handler(ctx, input): SendOutcome<Drafted> {
    const who = await requester(ctx);
    if (!input.groups.length || !input.title.trim() || !input.start_time.trim()) {
      throw new DataAccessError("invalid_value", "Thiếu nhóm (groups), nội dung nhắc (title) hoặc giờ nhắc (start_time) — hỏi lại người dùng.");
    }
    const result = await createReminderDraft(sendDepsOf(ctx), {
      requester: who.requester, ...sourceFor(ctx, who.threadId), question: sendQuestionOf(ctx), groupNames: input.groups, title: input.title,
      startTime: input.start_time, repeat: input.repeat ?? "",
    }, ctx.now);
    return drafted(result, "Đã tạo nháp và gửi bản xem trước cho người dùng; họ nhắn «đồng ý» mới tạo nhắc hẹn. Không viết thêm gì, không nói đã tạo.");
  },
};

export const SEND_DRAFT_TOOLS: readonly AnyToolDefinition[] = [
  eraseTool(proposeSendMessage), eraseTool(proposeGroupReminder), eraseTool(sendDraftCreate), eraseTool(sendPinDraftCreate),
];
