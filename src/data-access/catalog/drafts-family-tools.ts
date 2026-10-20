import { z } from "zod/v4";
import { McpCallSource } from "../../constants.js";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { executeOpenDraft } from "../write/confirm-write-tool.js";
import { cancelDraft, findOpenDraft, listOpenDrafts, type DraftBinding, type DraftRecord } from "../write/write-draft-store.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";
import type { FamilyCatalog } from "./family-catalog.js";

// Họ `drafts`: xác nhận / hủy nháp ghi do MẶT LỆNH (`assistant_command`) — chạy khi người hỏi nhắn «đồng ý» / «hủy» ở tin sau. Mô hình
// KHÔNG có mặt này (máy chủ của nó không đăng ký) nên không thể tự xác nhận (D1) — nay bảo đảm bằng cấu trúc thay cho việc chỉ không khai báo.
// Nháp ràng buộc (người, nguồn Assistant): nháp do công cụ `propose_*` của mô hình tạo (nguồn 2); lời gọi này ghi nhật ký nguồn 3.

export const DRAFT_NOT_FOUND_MESSAGE = "Mã không đúng, đã hết hạn (10 phút) hoặc đã dùng — nhờ em tạo đề xuất mới.";

const draftRefInput = z.object({
  code: z.string().trim().min(4).max(12).optional().describe("Mã xác nhận 6 ký tự người hỏi gõ."),
  draft_id: z.number().int().positive().optional().describe("Mã nháp (khi người hỏi chỉ gõ «đồng ý» và có đúng một nháp chờ)."),
}).strict().refine((value) => value.code !== undefined || value.draft_id !== undefined, { message: "Cần code hoặc draft_id" });
type DraftRefInput = z.infer<typeof draftRefInput>;

/** Chỉ người hỏi có quyền ghi qua trợ lý (`allowWrite` do lớp trợ lý đặt: tài khoản web, tin riêng thật, Quản trị / Quản lý). */
const availableToWriter = (ctx: DataAccessContext): boolean => ctx.allowWrite && ctx.principal.userId !== null;

function bindingOf(ctx: DataAccessContext): DraftBinding {
  return { tenantId: ctx.principal.tenantId, userId: ctx.principal.userId!, keyId: null, source: McpCallSource.Assistant };
}

async function findDraft(ctx: DataAccessContext, input: DraftRefInput): Promise<DraftRecord> {
  const binding = bindingOf(ctx);
  const draft = input.code !== undefined
    ? await findOpenDraft(ctx.db, binding, input.code, ctx.now)
    : (await listOpenDrafts(ctx.db, binding, ctx.now)).find((item) => item.id === input.draft_id) ?? null;
  if (!draft) throw new DataAccessError("invalid_code", DRAFT_NOT_FOUND_MESSAGE);
  return draft;
}

const confirmOutput = z.object({ done: z.literal(true), entity: z.string(), id: z.number().nullable(), changed_fields: z.array(z.string()), message: z.string() });
const cancelOutput = z.object({ cancelled: z.boolean(), preview: z.string() });

const confirmDraftTool: ToolDefinition<DraftRefInput, z.infer<typeof confirmOutput>> = {
  name: "confirm_draft",
  title: "Xác nhận nháp (lệnh «đồng ý»)",
  description: "Thực hiện MỘT nháp ghi đang chờ của người hỏi — chỉ chạy khi chính người hỏi nhắn «đồng ý». Kiểm lại quyền và trạng thái hiện tại của bản ghi.",
  input: () => draftRefInput,
  output: confirmOutput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  surfaces: ["assistant_command"],
  family: "drafts",
  available: availableToWriter,
  async handler(ctx, input) {
    const draft = await findDraft(ctx, input);
    // Bảng thao tác nạp lúc gọi (không lúc nạp mô-đun): danh mục ghi nạp danh mục họ — import tĩnh sẽ thành vòng
    const { WRITE_ACTIONS } = await import("../write/write-tool-catalog.js");
    const done = await executeOpenDraft(ctx, WRITE_ACTIONS, draft);
    return {
      structured: { done: true as const, entity: done.entity, id: done.id, changed_fields: done.changed, message: done.message },
      summary: done.message, rowCount: 1, entity: done.entity,
    };
  },
};

const cancelDraftTool: ToolDefinition<DraftRefInput, z.infer<typeof cancelOutput>> = {
  name: "cancel_draft",
  title: "Hủy nháp (lệnh «hủy»)",
  description: "Bỏ MỘT nháp ghi đang chờ của người hỏi khi họ nhắn «hủy». Dữ liệu giữ nguyên.",
  input: () => draftRefInput,
  output: cancelOutput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_command"],
  family: "drafts",
  available: availableToWriter,
  async handler(ctx, input) {
    const draft = await findDraft(ctx, input);
    const cancelled = await cancelDraft(ctx.db, draft.id, ctx.now);
    return { structured: { cancelled, preview: draft.preview }, summary: cancelled ? "Đã hủy nháp." : "Nháp đã hết hạn hoặc đã xử lý.", rowCount: 1, entity: "write_draft" };
  },
};

export const draftsFamilyCatalog: FamilyCatalog = {
  family: "drafts",
  tools: [eraseTool(confirmDraftTool), eraseTool(cancelDraftTool)] as readonly AnyToolDefinition[],
  actions: [],
  instructions: "",
};
