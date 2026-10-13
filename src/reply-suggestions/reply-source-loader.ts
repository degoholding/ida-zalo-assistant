import type { RowDataPacket } from "mysql2";
import { ConversationType } from "../constants.js";
import type { Db } from "../db/pool.js";
import { maskPersonalData } from "../privacy/personal-data.js";
import type { ReplySource } from "./reply-suggestion-types.js";

// Nạp tin gốc cần trả lời + ngữ cảnh (phase 10 — N2). Cùng phạm vi các công cụ đọc tin khác: nhóm đang «Đọc tin», KHÔNG BAO GIỜ nhóm Mật;
// cuộc nhắn riêng thì CHỈ cuộc của chính người hỏi (id tin là số tăng dần — đoán id là đọc được tin riêng người khác gửi bot).
// Lỗi trả dạng `{ error }` (chữ cho mô hình / người hỏi), không ném.

const CONTEXT_MESSAGES = 5;
const CONTEXT_WINDOW_MS = 3 * 86_400_000;
const MAX_TEXT = 1500;

export const CONFIDENTIAL_REFUSAL = "Tin này thuộc nhóm Mật — bot không đưa nội dung nhóm cho AI nên không soạn gợi ý được.";

export type LoadSourceResult = { source: ReplySource } | { error: string };

export interface LoadSourceOptions {
  /** Hỏi trong nhóm: chỉ nhận tin của chính nhóm đó. */
  scopeGroupId?: number;
  /** Mã Zalo người hỏi — tin trong cuộc nhắn riêng chỉ nhận khi đó là cuộc của chính họ. */
  askerUid?: string;
  maskPersonal: boolean;
}

export const OTHER_DIRECT_REFUSAL = "Tin này nằm trong cuộc nhắn riêng của người khác với bot — không soạn gợi ý được.";

export async function loadReplySource(db: Db, messageId: number, options: LoadSourceOptions): Promise<LoadSourceResult> {
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return { error: "message_id không hợp lệ — lấy id từ kết quả search_messages." };
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT m.id, m.group_id, m.sender_name, m.sent_at, m.text, g.thread_type, g.zalo_group_id, g.read_messages, g.is_confidential,
            COALESCE(NULLIF(g.label, ''), g.name) AS group_name
     FROM message m JOIN zalo_group g ON g.id = m.group_id
     WHERE m.id = ? AND m.recalled_at IS NULL`, [messageId]);
  const row = rows[0];
  if (!row) return { error: "Không tìm thấy tin này (hoặc đã bị thu hồi)." };
  if (row.is_confidential) return { error: CONFIDENTIAL_REFUSAL };
  if (!row.read_messages) return { error: "Cuộc này không được bot lưu / đọc tin nên không soạn gợi ý được." };
  if (options.scopeGroupId && Number(row.group_id) !== options.scopeGroupId) return { error: "Tin này nằm ngoài nhóm đang hỏi." };
  const isDirect = Number(row.thread_type) === ConversationType.Direct;
  if (isDirect && (!options.askerUid || String(row.zalo_group_id) !== options.askerUid)) return { error: OTHER_DIRECT_REFUSAL };
  const text = String(row.text ?? "").trim();
  if (!text) return { error: "Tin này không có chữ (ảnh / tệp) nên không soạn gợi ý được." };

  const [earlier] = await db.query<RowDataPacket[]>(
    `SELECT sender_name, sent_at, text FROM message
     WHERE group_id = ? AND id <> ? AND sent_at < ? AND sent_at >= ? AND recalled_at IS NULL AND text IS NOT NULL AND text <> ''
     ORDER BY sent_at DESC LIMIT ?`,
    [row.group_id, row.id, row.sent_at, new Date(new Date(row.sent_at).getTime() - CONTEXT_WINDOW_MS), CONTEXT_MESSAGES]);

  const prepare = (value: unknown) => {
    const clipped = String(value ?? "").slice(0, MAX_TEXT);
    return options.maskPersonal ? maskPersonalData(clipped) : clipped;
  };
  return {
    source: {
      messageId: Number(row.id),
      groupName: isDirect ? "nhắn riêng bot" : String(row.group_name ?? ""),
      senderName: String(row.sender_name ?? ""),
      sentAt: new Date(row.sent_at),
      text: prepare(text),
      context: earlier.reverse().map((item) => ({ senderName: String(item.sender_name ?? ""), sentAt: new Date(item.sent_at), text: prepare(item.text) })),
    },
  };
}
