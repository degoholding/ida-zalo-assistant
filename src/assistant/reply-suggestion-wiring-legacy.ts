// mcp-guard: legacy(files) — đường CŨ: kiểm tin gốc đọc được bằng visibility-guards (họ `files` tắt); khi họ bật việc này nằm trong công cụ lệnh `reply_sources`; phase 13 gỡ
import { DataAccessError } from "../data-access/data-access-errors.js";
import { assertMessageReadable } from "../data-access/visibility-guards.js";
import { relaxConfidential, type AskerAccess } from "./infra/asker-access.js";

export const REPLY_SOURCE_NOT_FOUND = "Không tìm thấy tin này (hoặc đã bị thu hồi).";

/**
 * Tin gốc phải nằm trong phạm vi người hỏi (cuộc riêng của người khác / nhóm ngoài phạm vi = như không có); chặn Mật do bộ nạp tin lo.
 * Trả câu lỗi cho mô hình, hoặc null nếu hợp lệ / không truyền message_id hợp lệ.
 */
export async function replySourcePrecheckLegacy(access: AskerAccess, messageId: number): Promise<string | null> {
  try {
    await assertMessageReadable(relaxConfidential(access), messageId);
    return null;
  } catch (error) {
    if (error instanceof DataAccessError && error.code === "not_found") return REPLY_SOURCE_NOT_FOUND;
    throw error;
  }
}
