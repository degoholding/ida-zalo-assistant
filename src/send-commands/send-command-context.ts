import type { RowDataPacket } from "mysql2";
import type { ContactRow } from "../sync/contact-repository.js";
import type { SendChatContext } from "./send-command-chat.js";
import type { SendCommandDeps } from "./send-command-deps.js";
import { loadSendRequester } from "./send-target-resolver.js";

// Dựng ngữ cảnh lệnh gửi cho một lượt hỏi trong tin riêng (phase 9) — dùng chung cho lệnh gõ và công cụ AI. Cuộc của màn «Hỏi
// trợ lý» web (`web-…`) và dữ liệu mẫu (`demo-…`) không phải Zalo thật → không có ngữ cảnh gửi (web không ra lệnh gửi ở giai đoạn này).

/** Tiền tố mã cuộc không đi ra Zalo thật: màn «Hỏi trợ lý» web, dữ liệu mẫu. */
const NON_ZALO_THREAD_PREFIXES = ["web-", "demo-"];

export interface SendContextRequest {
  contact: Pick<ContactRow, "id" | "zalo_uid" | "display_name" | "zalo_name">;
  threadId: number;
  questionMessageId: number | null;
  botAccountId: number;
  question: string;
}

export async function buildSendChatContext(deps: SendCommandDeps, request: SendContextRequest): Promise<SendChatContext | null> {
  const [threads] = await deps.db.query<RowDataPacket[]>("SELECT zalo_group_id FROM zalo_group WHERE id = ? LIMIT 1", [request.threadId]);
  const zaloThreadId = String(threads[0]?.zalo_group_id ?? "");
  if (!threads[0] || NON_ZALO_THREAD_PREFIXES.some((prefix) => zaloThreadId.startsWith(prefix))) return null;
  const uid = request.contact.zalo_uid;
  return {
    deps, requester: await loadSendRequester(deps.db, uid), uid,
    name: request.contact.display_name || request.contact.zalo_name || uid, requesterContactId: request.contact.id,
    question: request.question, sourceThreadId: request.threadId, sourceMessageId: request.questionMessageId, botAccountId: request.botAccountId,
  };
}
