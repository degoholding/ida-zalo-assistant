import type { Db } from "../src/db/pool.js";
import { resolveAskerAccess, type AskerAccess } from "../src/assistant/infra/asker-access.js";
import { findContactByUid, type ContactRow } from "../src/sync/contact-repository.js";
import { ContactRole } from "../src/constants.js";

// Dụng cụ chung cho test tích hợp của trợ lý (phase 6): dựng người hỏi có vai trò Danh bạ + ngữ cảnh truy cập thật
// (qua resolveAskerAccess, không giả) để test công cụ chạy đúng đường như một lượt hỏi thật.

/** Tạo (nếu chưa có) liên hệ `uid` với vai trò `role`, trả liên hệ + ngữ cảnh truy cập của lượt hỏi. */
export async function askerWithAccess(
  db: Db, uid: string, options: { role?: ContactRole; groupScopeId?: number } = {},
): Promise<{ contact: ContactRow; access: AskerAccess }> {
  await db.query("INSERT IGNORE INTO contact (zalo_uid, display_name) VALUES (?, ?)", [uid, uid]);
  await db.query("UPDATE contact SET role = ? WHERE zalo_uid = ?", [options.role ?? ContactRole.Manager, uid]);
  const contact = (await findContactByUid(db, uid))!;
  const access = await resolveAskerAccess(db, contact, { groupScopeId: options.groupScopeId, maskPersonal: false });
  return { contact, access };
}
