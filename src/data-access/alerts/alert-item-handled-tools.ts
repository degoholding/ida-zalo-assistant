import { z } from "zod/v4";
import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";
import { executeImmediateWrite } from "../write/immediate-write.js";
import { eraseAction } from "../write/write-action.js";
import { ALERT_TOOL_DECLARATIONS } from "../../assistant/alert-tools.js";
import { alertToolsAvailable } from "./alert-asker-facts.js";
import { alertItemHandledAction } from "./alert-write-actions.js";

// «Xong tin số N»: đánh dấu tin cần xử lý đã xong — mặt mô hình `mark_item_handled` (tên + khai báo giữ nguyên) và mặt lệnh gõ `alert_item_mark_handled`.
// Cả hai GHI NGAY (BC1 bỏ: ghi theo quan hệ giữ như hôm nay); phạm vi + quyền kiểm ở `prepare` của `alert_item_handled`.

const writeAction = eraseAction(alertItemHandledAction);
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false as const };
const MISSING_ID = "Thiếu message_id — gọi list_pending_items trước.";

const outputSchema = z.object({ ok: z.literal(true), message: z.string() });
type Output = z.infer<typeof outputSchema>;
const inputSchema = z.object({ message_id: z.number().int() });
type Input = z.infer<typeof inputSchema>;

async function markHandled(ctx: DataAccessContext, input: Input) {
  if (!Number.isSafeInteger(input.message_id) || input.message_id <= 0) throw new DataAccessError("invalid_value", MISSING_ID);
  const done = await executeImmediateWrite(ctx, writeAction, { message_id: input.message_id });
  return { structured: { ok: true as const, message: done.message } satisfies Output, summary: `Đã đánh dấu xong tin #${input.message_id}`, rowCount: 1, entity: "message" };
}

const description = ALERT_TOOL_DECLARATIONS.find((tool) => tool.name === "mark_item_handled")?.description ?? "";

const modelTool: ToolDefinition<Input, Output> = {
  name: "mark_item_handled", title: "Đánh dấu tin đã xử lý", description, annotations: WRITE,
  input: () => inputSchema, output: outputSchema,
  surfaces: ["assistant_model"], family: "alerts", assistantErrorShape: "string", available: alertToolsAvailable, handler: markHandled,
};

const commandTool: ToolDefinition<Input, Output> = {
  name: "alert_item_mark_handled", title: "Đánh dấu tin đã xử lý (lệnh «xong tin số N»)", annotations: WRITE,
  description: "Đánh dấu một tin trong danh sách «cần xử lý» của người đang nhắn là đã xong; ghi ngay (lệnh gõ = xác nhận). Chỉ lệnh gõ.",
  input: () => inputSchema, output: outputSchema,
  surfaces: ["assistant_command"], family: "alerts", available: alertToolsAvailable, handler: markHandled,
};

export const ALERT_ITEM_HANDLED_TOOLS: readonly AnyToolDefinition[] = [eraseTool(modelTool), eraseTool(commandTool)];
