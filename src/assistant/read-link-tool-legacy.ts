// mcp-guard: legacy(files) — đường CŨ của read_link: kiểm link có trong tin người hỏi thấy được bằng SQL (họ `files` tắt); phase 13 gỡ
import type { RowDataPacket } from "mysql2";
import { threadVisibilitySql } from "../data-access/visibility-guards.js";
import type { Db } from "../db/pool.js";
import type { AskerAccess } from "./infra/asker-access.js";

// Công cụ read_link (07/10/2026): đọc nội dung link người dùng gửi — Google Sheets / Docs / Slides / Drive (chia sẻ
// «Bất kỳ ai có đường liên kết», không cần Google Cloud), trang web. Chống rò dữ liệu: chỉ đọc link ĐÃ CÓ trong tin nhắn
// (của nhóm đang hỏi nếu hỏi trong nhóm) hoặc trong chính câu hỏi — mô hình bị tin nhắn «dụ» cũng không tự chế link
// nhét dữ liệu nội bộ vào đường dẫn được.

const LINK_LOOKBACK_DAYS = 60;

export async function linkWasSharedLegacy(db: Db, access: AskerAccess, fingerprint: string, scopeGroupId: number | undefined): Promise<boolean> {
  const escaped = fingerprint.replace(/[\\%_]/g, (char) => `\\${char}`);
  // Link chỉ tính khi nằm trong tin của cuộc người hỏi THẤY ĐƯỢC (phạm vi + cuộc riêng của mình + Mật theo cờ) — không thì
  // «đọc link» thành đường đọc nội dung cuộc riêng của người khác / nhóm Mật
  const visible = threadVisibilitySql(access, "g");
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM message m JOIN zalo_group g ON g.id = m.group_id
     WHERE m.text LIKE ? AND m.sent_at > NOW() - INTERVAL ? DAY AND m.recalled_at IS NULL AND ${visible.sql} ${scopeGroupId ? "AND m.group_id = ?" : ""} LIMIT 1`,
    [`%${escaped}%`, LINK_LOOKBACK_DAYS, ...visible.params, ...(scopeGroupId ? [scopeGroupId] : [])],
  );
  return rows.length > 0;
}

