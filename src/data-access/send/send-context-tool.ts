import { z } from "zod/v4";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";
import { hasSendTurn, resolveSendContext } from "./send-requester-facts.js";

// Công cụ lệnh `send_context` (họ `send`, mặt `assistant_command` — mô hình không thấy): cuộc đang nhắn có phải Zalo thật và người hỏi có là người ra lệnh
// gửi được không. Thay hai câu SQL của `buildSendChatContext` (zalo_group + loadSendRequester). Danh tính từ `contactActor`, không từ tham số.

const emptyInput = z.object({}).strict();
const outputSchema = z.object({
  zalo_thread: z.boolean(),
  requester: z.object({ uid: z.string(), name: z.string(), role: z.number(), recipient_id: z.number().nullable() }).nullable(),
});
type Output = z.infer<typeof outputSchema>;

const sendContext: ToolDefinition<Record<string, never>, Output> = {
  name: "send_context", title: "Ngữ cảnh gửi của người đang nhắn",
  description: "Cuộc đang nhắn có phải tin Zalo thật không, và người hỏi có được ra lệnh gửi tin không (người nhận đang bật hoặc có vai trò). Chỉ lệnh gõ.",
  input: () => emptyInput as unknown as z.ZodType<Record<string, never>>, output: outputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_command"], family: "send", available: hasSendTurn,
  async handler(ctx) {
    const resolved = await resolveSendContext(ctx);
    const requester = resolved.requester && { uid: resolved.requester.uid, name: resolved.requester.name, role: Number(resolved.requester.role), recipient_id: resolved.requester.recipientId };
    return { structured: { zalo_thread: resolved.zaloThread, requester }, summary: resolved.zaloThread ? "Tin riêng Zalo" : "Không phải tin Zalo thật", rowCount: 1 };
  },
};

export const SEND_CONTEXT_TOOLS: readonly AnyToolDefinition[] = [eraseTool(sendContext)];
