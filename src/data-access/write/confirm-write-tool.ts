import { z } from "zod/v4";
import { currentPrincipal } from "../../auth/principal.js";
import { McpCallSource } from "../../constants.js";
import { createLogger, describeError } from "../../logger.js";
import { canUse, type DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { eraseTool, type AnyToolDefinition } from "../tool-definition.js";
import { canPropose, type AnyWriteAction, type WriteExecuted } from "./write-action.js";
import { claimDraft, DraftOutcome, draftBindingOf, findOpenDraft, hashPayload, saveDraftResult, type DraftRecord } from "./write-draft-store.js";
import { guardWrite } from "./write-errors.js";
import { STALE_MESSAGE } from "./write-row-lock.js";

// `confirm_write {code}` (CHỈ MCP — trợ lý xác nhận bằng tin «đồng ý» của người dùng, xem src/assistant/write-confirm-chat.ts) và bộ thực
// thi dùng chung `executeOpenDraft`. Thứ tự (mỗi bước chặn là một lỗi riêng, nháp chỉ bị tiêu thụ ngay trước khi chạy):
//  mã → băm payload → quyền + đích HIỆN TẠI (dựng lại nháp bằng prepare) → dấu trạng thái → tiêu thụ + đánh dấu «attempted» → chạy.

const log = createLogger("write-confirm");

const confirmInput = z.object({
  code: z.string().trim().min(4).max(12).describe("Mã xác nhận 6 ký tự nhận được từ công cụ propose_*."),
}).strict();

const confirmOutput = z.object({
  done: z.literal(true), entity: z.string(), id: z.number().nullable(), changed_fields: z.array(z.string()), message: z.string(),
});

export const INVALID_CODE = "Mã xác nhận không đúng, đã hết hạn (10 phút) hoặc đã dùng — tạo nháp mới bằng công cụ propose_*.";

const PARTIAL_FAILURE = "Thao tác đã được thử nhưng gặp lỗi giữa chừng — có thể đã ghi MỘT PHẦN (hoặc đã báo Zalo). Kiểm tra lại bản ghi trước, đừng đề xuất lại ngay kẻo bị trùng.";

/**
 * Thực hiện MỘT nháp còn hiệu lực (đã tìm đúng người / khóa / nguồn). Kiểm lại băm, quyền, phạm vi, trạng thái; tiêu thụ nguyên tử; lưu
 * `result_json.status = attempted` TRƯỚC khi ghi (M2) để lỗi sau tác dụng phụ (báo Zalo…) không dẫn tới đề xuất lại gây trùng.
 */
export async function executeOpenDraft(ctx: DataAccessContext, actions: ReadonlyMap<string, AnyWriteAction>, draft: DraftRecord): Promise<WriteExecuted> {
  const { principal } = ctx;
  if (hashPayload(draft.payload) !== draft.payloadHash) throw new DataAccessError("invalid_code", INVALID_CODE);
  const action = actions.get(draft.tool);
  if (!action || !canPropose(ctx, action) || (action.permission !== "relationship" && !canUse(ctx, action.entity, "write"))) throw new DataAccessError("forbidden", "Tài khoản / khóa này không còn quyền thực hiện nháp này.");
  const { args, state } = draft.payload as { args: unknown; state: string };
  const parsed = action.schema.safeParse(args);
  if (!parsed.success) throw new DataAccessError("invalid_code", INVALID_CODE);
  // Dựng lại nháp với quyền + trạng thái HIỆN TẠI (principal đã nạp lại ở request này)
  const current = await guardWrite(() => action.prepare(ctx, parsed.data));
  if (current.stateToken !== state) throw new DataAccessError("stale_target", STALE_MESSAGE);
  if (!(await claimDraft(ctx.db, draft.id, ctx.now))) throw new DataAccessError("invalid_code", INVALID_CODE);
  await saveDraftResult(ctx.db, draft.id, { status: DraftOutcome.Attempted });
  // Nhật ký thao tác (audit_log.actor) mang tên người thật + cổng gọi
  const actor = { ...principal, fullName: `${principal.fullName} · ${ctx.source === McpCallSource.Http ? "MCP" : "Trợ lý"}` };
  try {
    const done = await guardWrite(() => currentPrincipal.run(actor, () => action.execute(ctx, parsed.data, state)));
    await saveDraftResult(ctx.db, draft.id, { status: DraftOutcome.Done, entity: done.entity, id: done.id, changed: done.changed });
    return done;
  } catch (error) {
    if (error instanceof DataAccessError) {
      // Bị từ chối có kiểm soát (stale / quyền / dữ liệu) — chưa ghi gì; nháp đã dùng nên cần đề xuất lại
      await saveDraftResult(ctx.db, draft.id, { status: DraftOutcome.Rejected, code: error.code }).catch(() => undefined);
      throw error;
    }
    log.error(`nháp #${draft.id} (${draft.tool}) lỗi sau khi tiêu thụ: ${describeError(error)}`);
    await saveDraftResult(ctx.db, draft.id, { status: DraftOutcome.Failed, error: describeError(error).slice(0, 300) }).catch(() => undefined);
    throw new DataAccessError("invalid_state", PARTIAL_FAILURE);
  }
}

export function confirmWriteTool(actions: ReadonlyMap<string, AnyWriteAction>): AnyToolDefinition {
  const anyAction = (ctx: DataAccessContext) => [...actions.values()].some((action) => canPropose(ctx, action));
  return eraseTool({
    name: "confirm_write",
    title: "Xác nhận ghi dữ liệu",
    description:
      "THỰC HIỆN một nháp đã tạo bằng propose_*: ghi thật vào hệ thống (có nhật ký thao tác dưới tên người dùng). Chỉ gọi khi người dùng đã xem " +
      "bản xem trước và đồng ý rõ ràng; mã dùng một lần, gắn với đúng người + khóa, hiệu lực 10 phút. Hệ thống kiểm lại quyền và trạng thái hiện tại " +
      "của bản ghi — đã đổi từ lúc đề xuất thì từ chối, cần đề xuất lại.",
    input: () => confirmInput,
    output: confirmOutput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false as const },
    available: (ctx: DataAccessContext) => ctx.allowWrite && ctx.source === McpCallSource.Http && anyAction(ctx),
    handler: async (ctx: DataAccessContext, input: z.infer<typeof confirmInput>) => {
      const { principal } = ctx;
      if (principal.userId === null) throw new DataAccessError("forbidden", "Chỉ tài khoản web ghi được dữ liệu qua AI.");
      // Trợ lý KHÔNG xác nhận bằng công cụ (D1): mô hình không bao giờ tự xác nhận — chỉ tin «đồng ý» của người dùng, xử lý bằng mã ở chat-commands
      if (ctx.source !== McpCallSource.Http) throw new DataAccessError("forbidden", "Trợ lý chỉ thực hiện khi người dùng nhắn «đồng ý».");
      const draft = await findOpenDraft(ctx.db, draftBindingOf(ctx), input.code, ctx.now);
      if (!draft) throw new DataAccessError("invalid_code", INVALID_CODE);
      const done = await executeOpenDraft(ctx, actions, draft);
      return {
        structured: { done: true as const, entity: done.entity, id: done.id, changed_fields: done.changed, message: done.message },
        summary: done.message, rowCount: 1, entity: done.entity,
      };
    },
  });
}
