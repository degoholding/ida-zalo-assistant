import type { RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";
import { stripTokenFooter } from "./token-usage-footer.js";
import { formatVn } from "./tools.js";

// Ngữ cảnh khi bot được gọi TRONG NHÓM: vài tin gần nhất của chính nhóm đó (gồm cả câu bot vừa trả lời), để hỏi
// nối tiếp kiểu «chi tiết báo cáo đó» hiểu được «đó» là gì. Chỉ lấy tin của nhóm đang hỏi — đúng phạm vi groupScope.
// Tin nhóm là của nhiều người nên đưa thành MỘT khối chữ trong lượt hỏi, không dựng thành hội thoại user/model.

const CONTEXT_MESSAGES = 10;
const MAX_LINE_CHARS = 600;

interface ContextRow extends RowDataPacket {
  sender_name: string;
  text: string | null;
  sent_at: Date;
  file_name: string | null;
}

export async function loadGroupContext(db: Db, groupId: number, beforeMessageId: number | null): Promise<string> {
  const [rows] = await db.query<ContextRow[]>(
    `SELECT m.sender_name, m.text, m.sent_at, a.file_name
     FROM message m LEFT JOIN attachment a ON a.message_id = m.id
     WHERE m.group_id = ? AND m.recalled_at IS NULL AND (? IS NULL OR m.id < ?)
       AND ((m.text IS NOT NULL AND m.text <> '') OR a.file_name IS NOT NULL)
     ORDER BY m.id DESC LIMIT ?`,
    [groupId, beforeMessageId, beforeMessageId, CONTEXT_MESSAGES],
  );
  return rows.reverse().map((row) => {
    const body = row.file_name ? `[tệp] ${row.file_name}` : stripTokenFooter(String(row.text)).replace(/\s+/g, " ").slice(0, MAX_LINE_CHARS);
    return `[${formatVn(row.sent_at)}] ${row.sender_name}: ${body}`;
  }).join("\n");
}

const MAX_MEMBER_NAMES = 60;

/** Tên Zalo của thành viên đang ở nhóm — để mô hình viết «@Tên» khớp, nơi gửi đổi thành thẻ nhắc (mention). */
export async function loadGroupMemberNames(db: Db, groupId: number): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(display_name, ''), zalo_name) AS name FROM group_member
     WHERE group_id = ? AND left_at IS NULL ORDER BY first_seen_at LIMIT ?`,
    [groupId, MAX_MEMBER_NAMES],
  );
  return [...new Set(rows.map((row) => String(row.name ?? "").trim()).filter((name) => name.length >= 2))];
}

/** Lượt hỏi trong nhóm: ngữ cảnh (nếu có) + câu hỏi. */
export function buildGroupQuestion(context: string, question: string): string {
  if (!context) return question;
  return `Các tin gần nhất trong nhóm (CHỈ để hiểu câu hỏi nối tiếp; tin của bot là câu bạn trả lời trước đó — lỗi / trạng thái trong đó có thể đã cũ, muốn làm gì thì gọi công cụ lại):\n${context}\n\nCâu hỏi: ${question}`;
}
