import { ContactRole } from "../constants.js";
import type { Db } from "../db/pool.js";
import { isActiveRecipientUid } from "../recipients/recipient-repository.js";
import { linkedAccountStatus } from "./asker-access.js";

// Cổng tin riêng: ai được bot trả lời câu hỏi (ngoài lệnh ticket / việc / «hướng dẫn» mà mọi người dùng được).
// - Tài khoản web ĐANG BẬT gắn với người này: đủ (quyết định chủ 17/10/2026) — dữ liệu theo phạm vi tài khoản (asker-access.ts).
// - Tài khoản web gắn nhưng đã tắt hết: KHÔNG qua cổng dù còn vai trò Danh bạ / là người nhận (vá H3 review phase 4–6).
// - Chưa có tài khoản: như trước — có vai trò Danh bạ hoặc là người nhận đang bật.

export async function canAskInDirectChat(db: Db, contact: { role: number }, zaloUid: string, ticketCommandAllowed: boolean): Promise<boolean> {
  if (ticketCommandAllowed) return true;
  const account = await linkedAccountStatus(db, zaloUid);
  if (account === "active") return true;
  if (account === "disabled") return false;
  return contact.role !== ContactRole.None || await isActiveRecipientUid(db, zaloUid);
}
