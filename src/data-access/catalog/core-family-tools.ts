import { z } from "zod/v4";
import { describeEntitiesTool } from "../operations/describe-entities-operation.js";
import { queryRecordsTool } from "../operations/query-records-operation.js";
import { contactUpdateAction } from "../write/contact-write-tools.js";
import { formatDraftPreviewReply } from "../write/draft-preview-reply.js";
import { groupUpdateAction } from "../write/group-write-tools.js";
import { proposeTool } from "../write/propose-tool-factory.js";
import { replyTemplateSaveAction } from "../write/reply-template-write-tools.js";
import { eraseAction, type AnyWriteAction } from "../write/write-action.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";
import { CORE_QUERY_TOOLS_INSTRUCTIONS } from "./core-family-instructions.js";
import type { FamilyCatalog } from "./family-catalog.js";
import { assertGroupScopeEntity } from "./group-scope-guard.js";

// Họ `core`: những công cụ ĐÃ ở lõi mà trợ lý dùng — query_records, describe_entities (đọc) và ba propose_* (ghi dạng nháp). Cùng định nghĩa
// với bản của cổng /mcp (cùng mô tả, cùng sơ đồ vào) nhưng là bản RIÊNG của mặt `assistant_model`, nên cổng ngoài không đổi.

/** Hai công cụ đọc: thêm luật «hỏi trong nhóm chỉ thực thể gắn nhóm» (dữ liệu, nên ở lõi) trước khi chạy. */
function queryToolForModel(tool: AnyToolDefinition): AnyToolDefinition {
  return {
    ...tool, surfaces: ["assistant_model"], family: "core",
    handler: async (ctx, input) => {
      assertGroupScopeEntity(ctx, (input as { entity?: unknown } | null)?.entity);
      return tool.handler(ctx, input);
    },
  };
}

const draftSentOutput = z.object({ done: z.literal(false), message: z.string() });
const DRAFT_SENT_MESSAGE = "Đã tạo nháp và hệ thống đã gửi bản xem trước + mã cho người hỏi. DỪNG: không viết thêm, không báo đã lưu; việc ghi chỉ chạy khi người hỏi nhắn «đồng ý».";

/**
 * `propose_*` cho mô hình: nháp tạo xong thì mã + bản xem trước đi vào `effects.fixedReply` (máy chủ gửi thẳng cho người hỏi) còn kết quả
 * trả mô hình ĐÃ BỎ mã (D1: mô hình không có đường xác nhận). Điều kiện mở (tài khoản web, tin riêng thật, Quản trị / Quản lý) nằm ở
 * `ctx.allowWrite` do lớp trợ lý đặt.
 */
function proposeToolForModel(action: AnyWriteAction): AnyToolDefinition {
  const base = proposeTool(action);
  const tool: ToolDefinition<unknown, z.infer<typeof draftSentOutput>> = {
    ...base, output: draftSentOutput, surfaces: ["assistant_model"], family: "core", blocksAfterFixedReply: true,
    handler: async (ctx, input) => {
      const outcome = await base.handler(ctx, input);
      const { code, preview } = (outcome.structured as { draft: { code: string; preview: string } }).draft;
      return {
        structured: { done: false as const, message: DRAFT_SENT_MESSAGE },
        summary: `Đã tạo nháp ${action.tool}: ${preview}`, rowCount: outcome.rowCount, entity: outcome.entity,
        effects: { fixedReply: formatDraftPreviewReply(preview, code) },
      };
    },
  };
  return eraseTool(tool);
}

export const coreFamilyCatalog: FamilyCatalog = {
  family: "core",
  tools: [
    queryToolForModel(describeEntitiesTool as unknown as AnyToolDefinition),
    queryToolForModel(queryRecordsTool as unknown as AnyToolDefinition),
    proposeToolForModel(eraseAction(contactUpdateAction)),
    proposeToolForModel(eraseAction(groupUpdateAction)),
    proposeToolForModel(eraseAction(replyTemplateSaveAction)),
  ],
  actions: [],
  instructions: CORE_QUERY_TOOLS_INSTRUCTIONS,
};
