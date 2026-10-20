import { maskPersonalData } from "../privacy/personal-data.js";
import type { ReplySource, ReplySourceReader, ReplyTemplate } from "../reply-suggestions/reply-suggestion-types.js";
import type { ReplyTemplateStatus, ReplyTone } from "../constants.js";
import { callFilesCommand } from "./files-command-call.js";
import type { AssistantMcpTurn } from "./mcp-bridge/assistant-mcp-turn.js";

// Nguồn đọc của «gợi ý trả lời» khi họ `files` bật: MỘT lần gọi công cụ lệnh `reply_sources` lấy số lượt trong giờ + tin gốc (có ngữ cảnh) + mẫu đã duyệt, rồi dịch vụ
// (`reply-suggestion-service`) dùng như bản SQL. Sinh bản nháp bằng AI là tác động ngoài, ở phía trợ lý. Mặt lệnh không che dữ liệu cá nhân nên che ở ĐÂY theo cài đặt.

export interface ReplySourcesBundle {
  hourlyCount: number;
  precheckError: string | null;
  source: ReplySource | null;
  sourceError: string | null;
  templates: ReplyTemplate[];
}

type Json = Record<string, unknown>;
const dateOrNull = (value: unknown): Date | null => (typeof value === "string" ? new Date(value) : null);

function parseBundle(data: Json, maskPersonal: boolean): ReplySourcesBundle {
  const prepare = (value: unknown) => (maskPersonal ? maskPersonalData(String(value ?? "")) : String(value ?? ""));
  const raw = data.source as { message_id: number; group_name: string; sender_name: string; sent_at: string; text: string; context: { sender_name: string; sent_at: string; text: string }[] } | null;
  const source: ReplySource | null = raw ? {
    messageId: raw.message_id, groupName: raw.group_name, senderName: raw.sender_name, sentAt: new Date(raw.sent_at), text: prepare(raw.text),
    context: raw.context.map((line) => ({ senderName: line.sender_name, sentAt: new Date(line.sent_at), text: prepare(line.text) })),
  } : null;
  const templates = (data.templates as Json[]).map((row): ReplyTemplate => ({
    id: Number(row.id), tenantId: Number(row.tenant_id), name: String(row.name), situation: String(row.situation), keywords: row.keywords as string[], body: String(row.body),
    tone: Number(row.tone) as ReplyTone, status: Number(row.status) as ReplyTemplateStatus,
    authorUserId: row.author_user_id === null ? null : Number(row.author_user_id), authorName: String(row.author_name),
    reviewerUserId: row.reviewer_user_id === null ? null : Number(row.reviewer_user_id), reviewerName: String(row.reviewer_name), reviewNote: String(row.review_note),
    submittedAt: dateOrNull(row.submitted_at), reviewedAt: dateOrNull(row.reviewed_at), createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)),
  }));
  return {
    hourlyCount: Number(data.hourly_count), precheckError: typeof data.precheck_error === "string" ? data.precheck_error : null,
    source, sourceError: typeof data.source_error === "string" ? data.source_error : null, templates,
  };
}

export interface ReplySourcesReaderHandle {
  reader: ReplySourceReader;
  /** Gọi `reply_sources` ngay (một lần, nhớ kết quả) — để kiểm tin gốc ngoài phạm vi TRƯỚC mọi bước khác như đường cũ. `{ error }` = lõi từ chối / lỗi công cụ. */
  fetch(): Promise<ReplySourcesBundle | { error: string }>;
}

/** `messageId` = id tin gốc mô hình đưa (đã kiểm là số nguyên), hoặc undefined khi không có tin cụ thể. */
export function replySourcesMcpReader(mcp: AssistantMcpTurn, messageId: number | undefined, maskPersonal: boolean): ReplySourcesReaderHandle {
  let pending: Promise<ReplySourcesBundle | { error: string }> | null = null;
  const fetch = () => (pending ??= callFilesCommand(mcp, { filesToSend: [] }, "reply_sources", messageId === undefined ? {} : { message_id: messageId })
    .then((result): ReplySourcesBundle | { error: string } => ("error" in result ? { error: String(result.error) } : parseBundle(result, maskPersonal))));
  const bundle = async (): Promise<ReplySourcesBundle> => {
    const result = await fetch();
    if ("error" in result) throw new Error(result.error);
    return result;
  };
  return {
    fetch,
    reader: {
      hourlyCount: async () => (await bundle()).hourlyCount,
      loadSource: async () => {
        const { source, sourceError } = await bundle();
        return source ? { source } : { error: sourceError ?? "Không tìm thấy tin này (hoặc đã bị thu hồi)." };
      },
      listApprovedTemplates: async () => (await bundle()).templates,
    },
  };
}
