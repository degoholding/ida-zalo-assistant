// mcp-guard: legacy(reads) — SQL ngữ cảnh nhóm cũ (khi họ `reads` tắt); phase 13 gỡ, còn công cụ MCP `group_context`
import type { RowDataPacket } from "mysql2";
import { MessageKind } from "../constants.js";
import type { Db } from "../db/pool.js";
import { stripTokenFooter } from "./token-usage-footer.js";
import { attachmentLabel, formatVn } from "./message-line-format.js";

// Ngữ cảnh khi bot được gọi TRONG NHÓM: vài tin gần nhất của chính nhóm đó (gồm cả câu bot vừa trả lời), để hỏi
// nối tiếp kiểu «chi tiết báo cáo đó» hiểu được «đó» là gì. Chỉ lấy tin của nhóm đang hỏi — đúng phạm vi groupScope.
// Tin nhóm là của nhiều người nên đưa thành MỘT khối chữ trong lượt hỏi, không dựng thành hội thoại user/model.

const CONTEXT_MESSAGES = 10;
const MAX_LINE_CHARS = 600;

interface ContextRow extends RowDataPacket {
  sender_name: string;
  kind: number;
  text: string | null;
  sent_at: Date;
  file_name: string | null;
  attachment_id: number | null;
  file_text: string | null;
}

export async function loadGroupContext(db: Db, groupId: number, beforeMessageId: number | null): Promise<string> {
  const [rows] = await db.query<ContextRow[]>(
    `SELECT m.sender_name, m.kind, m.text, m.sent_at, a.file_name, a.id AS attachment_id,
            IF(m.kind = ${MessageKind.Image}, LEFT(t.text, 2000), NULL) AS file_text
     FROM message m LEFT JOIN attachment a ON a.message_id = m.id LEFT JOIN attachment_text t ON t.attachment_id = a.id
     WHERE m.group_id = ? AND m.recalled_at IS NULL AND (? IS NULL OR m.id < ?)
       AND ((m.text IS NOT NULL AND m.text <> '') OR a.id IS NOT NULL)
     ORDER BY m.id DESC LIMIT ?`,
    [groupId, beforeMessageId, beforeMessageId, CONTEXT_MESSAGES],
  );
  return rows.reverse().map((row) => {
    // Tệp / ảnh: nhãn kèm mã (ảnh đã tự đọc thì kèm chữ + mô tả) rồi chú thích nếu có
    const caption = stripTokenFooter(String(row.text ?? "")).replace(/\s+/g, " ").slice(0, MAX_LINE_CHARS);
    const body = row.attachment_id ? `${attachmentLabel(row)}${caption ? ` ${caption}` : ""}` : caption;
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

/** Nguồn ngữ cảnh cũ (SQL trực tiếp) — dùng khi họ `reads` tắt, hoặc phiên MCP không cho công cụ `group_context`. */
export async function groupContextSourceLegacy(db: Db, groupId: number, beforeMessageId: number | null): Promise<{ memberNames: string[]; context: string }> {
  const memberNames = await loadGroupMemberNames(db, groupId);
  const context = await loadGroupContext(db, groupId, beforeMessageId);
  return { memberNames, context };
}
