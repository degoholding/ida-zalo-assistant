import { z } from "zod/v4";
import { cancelLatestDraft, cancelSendCommand, confirmDraft, listForRequester } from "../../send-commands/send-command-actions.js";
import { findLatestLiveDraft } from "../../send-commands/send-command-lifecycle-queries.js";
import { CONFIRM_TTL_MS } from "../../send-commands/send-command-limits.js";
import { NOT_ALLOWED_REPLY } from "../../send-commands/send-command-replies.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";
import { hasSendTurn, requireSendRequester, sendDepsOf } from "./send-requester-facts.js";

// Công cụ VÒNG ĐỜI nháp lệnh gửi (họ `send`, mặt `assistant_command` — mô hình KHÔNG có công cụ xác nhận): «đồng ý G-12» / «hủy G-12» / «lệnh gửi» và việc tìm nháp
// còn sống mới nhất cho «đồng ý» / «hủy» trơn (kho chờ xác nhận của lệnh gửi). Xác nhận chỉ chạy cho CHÍNH người ra lệnh (uid từ `contactActor`); luật kiểm lại
// quyền + từng nơi nhận + trần giờ nằm trong `confirmDraft` (nguyên tử ở `claimConfirm`, nên xác nhận hai lần không xếp việc hai lần).

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false as const };
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false as const };
const base = { surfaces: ["assistant_command"] as const, family: "send" as const, available: hasSendTurn };

const replyOutput = z.object({ handled: z.boolean(), reply: z.string(), command_id: z.number().optional(), ok: z.boolean().optional() });
type Reply = z.infer<typeof replyOutput>;
const commandRef = z.union([z.number().int().positive(), z.literal("latest")]);

type Done = { handled: boolean; reply: string; commandId?: number; ok?: boolean };
const asOutcome = (result: Done, summary: string) => ({
  structured: { handled: result.handled, reply: result.reply, ...(result.commandId !== undefined ? { command_id: result.commandId } : {}), ...(result.ok !== undefined ? { ok: result.ok } : {}) },
  summary, rowCount: result.handled ? 1 : 0, entity: "send_command",
});

const confirmInput = z.object({ command_id: commandRef }).strict();
const sendDraftConfirm: ToolDefinition<z.infer<typeof confirmInput>, Reply> = {
  ...base, name: "send_draft_confirm", title: "Xác nhận nháp lệnh gửi (lệnh «đồng ý G-12»)", annotations: WRITE, output: replyOutput, input: () => confirmInput,
  description: "Xác nhận nháp lệnh gửi của CHÍNH người hỏi (mã G-12 hoặc «latest» = nháp còn sống mới nhất) → xếp việc gửi nền. Chỉ lệnh gõ.",
  async handler(ctx, input) {
    const who = await requireSendRequester(ctx);
    if (!who) return asOutcome({ handled: true, reply: NOT_ALLOWED_REPLY }, "Không đủ quyền ra lệnh gửi");
    const result = await confirmDraft(sendDepsOf(ctx), who.requester, input.command_id, ctx.now);
    return asOutcome(result, result.ok ? `Đã xác nhận G-${result.commandId}` : "Chưa xác nhận");
  },
};

const sendDraftCancel: ToolDefinition<z.infer<typeof confirmInput>, Reply> = {
  ...base, name: "send_draft_cancel", title: "Hủy lệnh gửi (lệnh «hủy G-12»)", annotations: WRITE, output: replyOutput, input: () => confirmInput,
  description: "Hủy lệnh gửi Nháp / đang hẹn của CHÍNH người hỏi (mã G-12 hoặc «latest» = nháp còn sống mới nhất). Chỉ lệnh gõ.",
  async handler(ctx, input) {
    const actor = ctx.contactActor!;
    const deps = sendDepsOf(ctx);
    const result = input.command_id === "latest"
      ? await cancelLatestDraft(deps, actor.uid, actor.name, ctx.now)
      : await cancelSendCommand(deps, { via: "zalo", uid: actor.uid, name: actor.name }, input.command_id, ctx.now);
    return asOutcome(result, result.ok ? `Đã hủy G-${result.commandId}` : "Chưa hủy");
  },
};

const emptyInput = z.object({}).strict();
const listOutput = z.object({ reply: z.string() });
const sendDraftList: ToolDefinition<Record<string, never>, z.infer<typeof listOutput>> = {
  ...base, name: "send_draft_list", title: "Danh sách lệnh gửi của người hỏi (lệnh «lệnh gửi»)", annotations: READ, output: listOutput,
  input: () => emptyInput as unknown as z.ZodType<Record<string, never>>,
  description: "Lệnh đang hẹn + 5 lệnh gửi gần nhất của CHÍNH người hỏi. Chỉ lệnh gõ.",
  async handler(ctx) {
    const reply = await listForRequester(sendDepsOf(ctx), ctx.contactActor!.uid);
    return { structured: { reply }, summary: "Danh sách lệnh gửi", rowCount: 1, entity: "send_command" };
  },
};

const pendingOutput = z.object({ pending: z.boolean(), command_id: z.number().optional(), issued_at: z.number().optional() });
const sendDraftPending: ToolDefinition<Record<string, never>, z.infer<typeof pendingOutput>> = {
  ...base, name: "send_draft_pending", title: "Nháp lệnh gửi còn sống mới nhất", annotations: READ, output: pendingOutput,
  input: () => emptyInput as unknown as z.ZodType<Record<string, never>>,
  description: "Nháp lệnh gửi còn hạn xác nhận mới nhất của người hỏi (để «đồng ý» / «hủy» trơn chọn kho). `issued_at` = mili-giây epoch lúc dựng nháp theo giờ ứng dụng. Chỉ lệnh gõ.",
  async handler(ctx) {
    const draft = await findLatestLiveDraft(ctx.db, ctx.contactActor!.uid, ctx.now);
    if (!draft) return { structured: { pending: false }, summary: "Không có nháp", rowCount: 0, entity: "send_command" };
    // Lúc dựng nháp theo giờ APP: `confirm_expires_at` do app ghi = now + CONFIRM_TTL_MS (không dùng created_at — giờ DB, múi phiên DB)
    const issuedAt = draft.confirmExpiresAt ? draft.confirmExpiresAt.getTime() - CONFIRM_TTL_MS : draft.createdAt.getTime();
    return { structured: { pending: true, command_id: draft.id, issued_at: issuedAt }, summary: `Nháp G-${draft.id}`, rowCount: 1, entity: "send_command" };
  },
};

export const SEND_LIFECYCLE_TOOLS: readonly AnyToolDefinition[] = [
  eraseTool(sendDraftConfirm), eraseTool(sendDraftCancel), eraseTool(sendDraftList), eraseTool(sendDraftPending),
];
