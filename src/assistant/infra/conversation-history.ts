// mcp-guard: infra — lịch sử cuộc nhắn riêng của CHÍNH người hỏi với bot (ngữ cảnh hội thoại), không phải dữ liệu nghiệp vụ qua công cụ
import type { RowDataPacket } from "mysql2";
import type { Db } from "../../db/pool.js";
import { isAckText } from "../assistant-ack-texts.js";
import type { GeminiContent } from "../gemini-client.js";
import { stripTokenFooter } from "../token-usage-footer.js";

const HISTORY_MESSAGES = 12;

/** Lịch sử gần nhất của cuộc riêng (cả hai phía) — để hiểu câu nối tiếp kiểu "gửi tệp số 2". */
export async function loadHistory(db: Db, threadId: number, beforeMessageId: number | null, askerUid: string): Promise<GeminiContent[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT sender_uid, text FROM message
     WHERE group_id = ? AND text IS NOT NULL AND text <> '' AND (? IS NULL OR id < ?)
     ORDER BY id DESC LIMIT ?`,
    [threadId, beforeMessageId, beforeMessageId, HISTORY_MESSAGES],
  );
  const contents: GeminiContent[] = [];
  for (const row of rows.reverse()) {
    const role = row.sender_uid === askerUid ? "user" : "model";
    const last = contents[contents.length - 1];
    // Gemini đòi lượt user/model xen kẽ — gộp các tin liền nhau cùng phía
    // Dòng đo token dưới câu trả lời cũ không phải nội dung — bỏ đi, khỏi tốn token và khỏi để mô hình bắt chước
    const rowText = stripTokenFooter(String(row.text));
    // Câu «chờ em xíu» của bot không phải câu trả lời — để lại thì mô hình bắt chước, trả đúng câu chờ rồi không làm gì
    if (role === "model" && isAckText(rowText)) continue;
    if (last && last.role === role) last.parts[0].text = `${last.parts[0].text}\n${rowText}`;
    else contents.push({ role, parts: [{ text: rowText }] });
  }
  // Lịch sử phải mở đầu bằng lượt user
  while (contents.length && contents[0].role !== "user") contents.shift();
  return contents;
}
