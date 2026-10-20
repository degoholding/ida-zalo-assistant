import { DRAFT_NOT_FOUND_MESSAGE } from "../../data-access/catalog/drafts-family-tools.js";
import type { AssistantMcpTurn } from "./assistant-mcp-turn.js";

// «đồng ý» / «hủy» nháp ghi chạy qua MẶT LỆNH của máy chủ MCP trong tiến trình (`confirm_draft` / `cancel_draft`) thay cho gọi thẳng kho nháp.
// Câu trả lời cho người dùng KHÔNG đổi một ký tự so với đường cũ (write-confirm-chat.ts).

const shortPreview = (preview: string): string => preview.replace(/\s+/g, " ").slice(0, 160);

/** Phiên lệnh nếu họ `drafts` bật và máy chủ liệt kê cả hai công cụ; không thì undefined (dùng đường cũ). */
export async function draftCommandSession(turn: AssistantMcpTurn | undefined): Promise<AssistantMcpTurn | undefined> {
  if (!turn?.familyEnabled("drafts")) return undefined;
  const session = await turn.command();
  return ["confirm_draft", "cancel_draft", "list_open_drafts"].every((name) => session?.toolNames.has(name)) ? turn : undefined;
}

/** Nháp đang chờ — phần «đồng ý» / «hủy» cần (id, bản xem trước, lúc dựng). */
export interface PendingDraft {
  id: number;
  preview: string;
  createdAt: Date;
}

/** Liệt kê nháp chờ qua `list_open_drafts` (mặt lệnh); mới nhất trước. Lỗi hệ thống ném tiếp như đường cũ. */
export async function listOpenDraftsViaMcp(turn: AssistantMcpTurn): Promise<PendingDraft[]> {
  const result = await turn.callTool("assistant_command", "list_open_drafts", {});
  const drafts = (result.structuredContent as { drafts?: { id: number; preview: string; created_at: string }[] } | undefined)?.drafts;
  if (result.isError || !drafts) {
    const meta = (result._meta as Record<string, unknown> | undefined)?.["bot-tro-ly/error"] as { message?: string } | undefined;
    throw new Error(`liệt kê nháp qua MCP lỗi: ${meta?.message ?? "không rõ"}`);
  }
  return drafts.map((draft) => ({ id: draft.id, preview: draft.preview, createdAt: new Date(draft.created_at) }));
}

export interface DraftRef {
  code?: string;
  draftId?: number;
}

/** Chạy lệnh nháp qua MCP; trả đúng câu bot nhắn lại. Lỗi hệ thống (không phải lỗi nghiệp vụ) ném tiếp như đường cũ. */
export async function runDraftCommandViaMcp(turn: AssistantMcpTurn, kind: "confirm" | "cancel", ref: DraftRef): Promise<string> {
  const args = ref.code !== undefined ? { code: ref.code } : { draft_id: ref.draftId };
  const result = await turn.callTool("assistant_command", kind === "confirm" ? "confirm_draft" : "cancel_draft", args);
  const structured = result.structuredContent as Record<string, unknown> | undefined;
  if (result.isError || !structured) {
    const meta = (result._meta as Record<string, unknown> | undefined)?.["bot-tro-ly/error"] as { code?: string; message?: string } | undefined;
    if (!meta?.message || meta.code === "internal" || meta.code === "server_busy") throw new Error(`lệnh nháp qua MCP lỗi: ${meta?.message ?? "không rõ"}`);
    return meta.message === DRAFT_NOT_FOUND_MESSAGE ? meta.message : `Chưa ghi được: ${meta.message}`;
  }
  if (kind === "confirm") return `Đã xong: ${String(structured.message)}`;
  return structured.cancelled === true
    ? `Dạ, em đã bỏ đề xuất: ${shortPreview(String(structured.preview))}. Dữ liệu giữ nguyên.`
    : "Đề xuất này đã hết hạn hoặc đã xử lý rồi.";
}
