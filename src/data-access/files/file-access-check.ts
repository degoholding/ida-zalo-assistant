import type { DataAccessContext } from "../data-access-context.js";
import { DataAccessError } from "../data-access-errors.js";
import { CONFIDENTIAL_NOTICE } from "../reads/confidential-notice.js";
import { assertAttachmentReadable } from "../visibility-guards.js";

// «Tệp này người hỏi thấy được không» cho các công cụ họ `files`: ok / bị Mật chặn (trong phạm vi nhưng chưa có cờ) / không có (ngoài phạm vi —
// không lộ việc tệp tồn tại). Chép đúng `attachmentAccess` của đường cũ (assistant/file-access-tools-legacy.ts).

export const FILE_NOT_FOUND = "Không có tệp này.";

export async function attachmentAccessOf(ctx: DataAccessContext, attachmentId: number): Promise<"ok" | "confidential" | "missing"> {
  const check = async (access: DataAccessContext): Promise<boolean> => {
    try {
      await assertAttachmentReadable(access, attachmentId);
      return true;
    } catch (error) {
      if (error instanceof DataAccessError && error.code === "not_found") return false;
      throw error;
    }
  };
  if (await check(ctx)) return "ok";
  if (!ctx.includeConfidential && await check({ ...ctx, includeConfidential: true })) return "confidential";
  return "missing";
}

/** Ném `not_found` («Không có tệp này.») / `confidential` (câu Mật như cũ) nếu tệp không đọc được. */
export async function requireReadableAttachment(ctx: DataAccessContext, attachmentId: number): Promise<void> {
  const access = await attachmentAccessOf(ctx, attachmentId);
  if (access === "missing") throw new DataAccessError("not_found", FILE_NOT_FOUND);
  if (access === "confidential") throw new DataAccessError("confidential", CONFIDENTIAL_NOTICE);
}
