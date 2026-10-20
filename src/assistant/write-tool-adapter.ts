import { findTool } from "../data-access/read-tool-catalog.js";
import type { AnyToolDefinition } from "../data-access/tool-definition.js";
import { formatDraftPreviewReply } from "../data-access/write/draft-preview-reply.js";
import { roleMayWriteViaAi } from "../data-access/write/write-action.js";
import type { AskerAccess } from "./asker-access.js";
import { runCoreTool, toFunctionDeclaration } from "./core-tool-adapter.js";
import type { FunctionDeclaration } from "./gemini-client.js";

// Công cụ GHI của lõi (phase 8) cho trợ lý TRONG TIẾN TRÌNH: CHỈ `propose_*`. Mô hình không có công cụ xác nhận (D1): máy chủ gửi bản xem
// trước + mã, việc ghi chỉ chạy khi người hỏi nhắn «đồng ý» ở tin sau (xem write-confirm-chat.ts + chat-commands.ts). Việc / ticket đã có công
// cụ riêng của trợ lý (create_task, task_action, ticket_action…) với luật riêng nên không đưa thêm bản trùng lặp.
//
// Điều kiện mở: người hỏi có TÀI KHOẢN WEB đang bật (không phải principal suy ra), vai trò Quản trị / Quản lý (D3: Nhân viên chỉ đọc qua AI),
// hỏi ở tin RIÊNG thật trên Zalo (không phải mô phỏng từ web, không phải trong nhóm — mọi thành viên đọc câu trả lời), cài đặt công cụ lõi bật.

export const ASSISTANT_WRITE_TOOL_NAMES = ["propose_contact_update", "propose_group_update", "propose_reply_template_save"] as const;

/** Ngữ cảnh ghi cho lượt hỏi này, hoặc null = không có công cụ ghi / không xác nhận được. */
export function assistantWriteAccess(access: AskerAccess, scopeGroupId: number | undefined): AskerAccess | null {
  if (scopeGroupId !== undefined || access.origin !== "web_user" || access.principal.userId === null || !access.ownDirectUid) return null;
  const writable = { ...access, allowWrite: true };
  return roleMayWriteViaAi(writable) ? writable : null;
}

function findAssistantWriteTool(name: string): AnyToolDefinition | undefined {
  return (ASSISTANT_WRITE_TOOL_NAMES as readonly string[]).includes(name) ? findTool(name) : undefined;
}

/** Khai báo hàm của các công cụ ghi người hỏi này dùng được (rỗng nếu không đủ điều kiện). */
export function writeToolDeclarations(access: AskerAccess, scopeGroupId: number | undefined): FunctionDeclaration[] {
  const writable = assistantWriteAccess(access, scopeGroupId);
  if (!writable) return [];
  return ASSISTANT_WRITE_TOOL_NAMES.flatMap((name) => {
    const def = findAssistantWriteTool(name);
    const declaration = def ? toFunctionDeclaration(def, writable) : null;
    return declaration ? [declaration] : [];
  });
}

export { formatDraftPreviewReply };

export interface WriteToolOutcome {
  /** Kết quả đưa lại cho mô hình (đã bỏ mã xác nhận). */
  response: Record<string, unknown>;
  /** Câu trả lời CỦA CẢ LƯỢT do máy chủ dựng (bản xem trước nguyên văn + mã) — có khi vừa tạo nháp thành công. */
  fixedReply?: string;
}

/**
 * Chạy một công cụ ghi: kiểm điều kiện mở, rồi đi qua cùng bộ chạy lõi (zod, `available`, che dữ liệu, mcp_call_log). Nháp tạo xong thì
 * mã + bản xem trước đi vào `fixedReply` (máy chủ gửi thẳng cho người hỏi); mô hình KHÔNG nhận được mã.
 */
export async function runWriteTool(name: string, access: AskerAccess, scopeGroupId: number | undefined, args: Record<string, unknown>): Promise<WriteToolOutcome> {
  const def = findAssistantWriteTool(name);
  const writable = assistantWriteAccess(access, scopeGroupId);
  if (!def || !writable) {
    return { response: { error: { code: "forbidden", message: "Công cụ ghi không dùng được ở lượt này (cần tài khoản web, tin riêng thật và vai trò Quản trị / Quản lý)." } } };
  }
  const result = await runCoreTool(def, writable, args);
  const draft = result.draft as { code?: string; preview?: string } | undefined;
  if (!draft?.code || draft.preview === undefined) return { response: result };
  return {
    fixedReply: formatDraftPreviewReply(draft.preview, draft.code),
    response: { done: false, message: "Đã tạo nháp và hệ thống đã gửi bản xem trước + mã cho người hỏi. DỪNG: không viết thêm, không báo đã lưu; việc ghi chỉ chạy khi người hỏi nhắn «đồng ý»." },
  };
}
