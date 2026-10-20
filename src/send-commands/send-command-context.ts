import type { AskerAccess } from "../assistant/infra/asker-access.js";
import type { AssistantMcpTurn } from "../assistant/mcp-bridge/assistant-mcp-turn.js";
import type { ContactRow } from "../sync/contact-repository.js";
import type { ContactRole } from "../constants.js";
import type { SendChatContext } from "./send-command-chat.js";
import { buildSendChatContextLegacy } from "./send-command-context-legacy.js";
import type { SendCommandDeps } from "./send-command-deps.js";
import { withCommandSession } from "./send-command-session.js";
import { registerSendTurn } from "./send-turn-registry.js";

// Dựng ngữ cảnh lệnh gửi cho một lượt hỏi trong tin riêng (phase 9) — dùng chung cho lệnh gõ và công cụ AI. Cuộc của màn «Hỏi trợ lý» web (`web-…`)
// và dữ liệu mẫu (`demo-…`) không phải Zalo thật → không có ngữ cảnh gửi. Phase 12: có nguồn phiên MCP (`askerAccess`) → đăng ký nguyên văn tin + móc ứng dụng
// vào sổ lượt rồi hỏi công cụ `send_context` (cuộc có phải Zalo thật, người ra lệnh, quyền) thay vì SQL; không có → đường cũ (send-command-context-legacy.ts).

export interface SendContextRequest {
  contact: Pick<ContactRow, "id" | "zalo_uid" | "display_name" | "zalo_name">;
  threadId: number;
  questionMessageId: number | null;
  botAccountId: number;
  question: string;
  /** Ngữ cảnh truy cập của lượt (MỘT lần mỗi lượt — chủ thể liên hệ của nó là chủ thể của phiên MCP). Thiếu = đường cũ. */
  askerAccess?: () => Promise<AskerAccess>;
  /** Phiên MCP lệnh dùng chung của lượt (mở lười; nơi mở lo đóng). Thiếu mà có `askerAccess` = mỗi lần dùng tự mở phiên rồi đóng. */
  commandMcp?: () => Promise<AssistantMcpTurn | undefined>;
}

interface ContextRequesterWire {
  uid: string;
  name: string;
  role: number;
  recipient_id: number | null;
}

export async function buildSendChatContext(deps: SendCommandDeps, request: SendContextRequest): Promise<SendChatContext | null> {
  const actor = request.askerAccess ? (await request.askerAccess()).contactActor : undefined;
  if (!request.askerAccess || !actor) return buildSendChatContextLegacy(deps, request);
  registerSendTurn(actor, { question: request.question, deps: { calendar: deps.calendar, wakeJobs: deps.wakeJobs, requestDownload: deps.requestDownload } });
  const via = await withCommandSession({ mcp: request.commandMcp, access: request.askerAccess, deps }, ["send_context"], (call) => call("send_context", {}));
  if (!via) return buildSendChatContextLegacy(deps, request);
  if (via.value.zalo_thread !== true) return null;
  const wire = via.value.requester as ContextRequesterWire | null;
  const uid = request.contact.zalo_uid;
  return {
    deps, requester: wire && { uid: wire.uid, name: wire.name, role: wire.role as ContactRole, recipientId: wire.recipient_id }, uid,
    name: request.contact.display_name || request.contact.zalo_name || uid, requesterContactId: request.contact.id,
    question: request.question, sourceThreadId: request.threadId, sourceMessageId: request.questionMessageId, botAccountId: request.botAccountId,
    mcp: request.commandMcp, access: request.askerAccess,
  };
}
