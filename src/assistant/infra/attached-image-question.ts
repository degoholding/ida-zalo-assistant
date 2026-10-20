// mcp-guard: infra — ảnh người hỏi VỪA gửi kèm câu hỏi (câu hỏi mở 4, 19/10/2026)
import type { RowDataPacket } from "mysql2";
import { MessageKind } from "../../constants.js";
import type { Db } from "../../db/pool.js";

// Ảnh kèm chú thích (dán ảnh rồi gõ chữ lên ảnh, gặp thật 15/10/2026: «đọc cái hình này cho anh nha đệ» → bot im):
// Zalo gửi MỘT tin ảnh, chú thích nằm trong tin đó. Chú thích là câu hỏi; thêm dòng chỉ đúng mã ảnh để trợ lý read_file
// ngay ảnh vừa gửi thay vì đoán / search_files (ảnh Zalo không có tên tệp để tìm).

/** Dòng nối vào câu hỏi: ảnh đi kèm tin này là tệp #id. */
export function attachedImageNote(attachmentId: number): string {
  return `[Tin này kèm một ẢNH: tệp #${attachmentId}. Câu hỏi nhắc tới ảnh / hình thì gọi read_file với attachment_id = ${attachmentId}.]`;
}

/** Câu hỏi + dòng chỉ mã ảnh nếu tin `messageId` là tin ảnh có tệp; không phải thì trả nguyên câu hỏi. */
export async function questionWithAttachedImage(db: Db, messageId: number | null, question: string): Promise<string> {
  if (!messageId) return question;
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT a.id FROM attachment a JOIN message m ON m.id = a.message_id WHERE a.message_id = ? AND m.kind = ?",
    [messageId, MessageKind.Image]);
  return rows[0] ? `${question}\n\n${attachedImageNote(Number(rows[0].id))}` : question;
}
