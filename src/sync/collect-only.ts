import type { RowDataPacket } from "mysql2";
import { BotAccountKind, ConversationType } from "../constants.js";
import type { Db } from "../db/pool.js";

// «Chỉ lưu» (17/10/2026): cuộc trò chuyện mà KHÔNG có bot Trợ lý nào ở trong thì bot chỉ gom dữ liệu — mọi xử lý TỰ ĐỘNG
// (cảnh báo, bắt việc, đọc ảnh, recap họp, bản tin / báo cáo định kỳ) bỏ qua. Xem / tìm / hỏi MCP / hỏi trợ lý vẫn như thường.
//   Nhóm     : KHÔNG có bot Trợ lý nào đang ở (left_at IS NULL) VÀ nhóm từng có bot Normal (bỏ qua left_at phía Normal).
//              «Dính»: bot Normal rời nhóm rồi thì nhóm vẫn là chỉ lưu (Trợ lý đã vắng thì không ai xử lý tự động), chỉ khi
//              bot Trợ lý vào nhóm mới hết chỉ lưu. Nhóm chưa từng có bot Normal (Trợ lý rời hết) giữ hành vi cũ.
//              Phân loại theo bảng bot_group — làm mới khi quét lúc khởi động / sự kiện vào-rời nhóm / admin «Quét lại».
//   Cuộc riêng: bot chủ cuộc (owner_bot_id) là bot Normal.
// Một nơi duy nhất định nghĩa luật này: mọi chỗ lọc «chỉ lưu» dùng hai hàm SQL dưới đây hoặc `isCollectOnlyThread`.

/** `activeOnly` false = tính cả dòng bot đã rời (left_at đã đặt) */
const BOT_IN_GROUP = (alias: string, kind: BotAccountKind, activeOnly: boolean): string =>
  `EXISTS (SELECT 1 FROM bot_group cob JOIN bot_account coa ON coa.id = cob.bot_account_id
           WHERE cob.group_id = ${alias}.id${activeOnly ? " AND cob.left_at IS NULL" : ""} AND coa.kind = ${kind})`;

/**
 * Mệnh đề SQL (boolean) đúng khi cuộc `alias` (bảng zalo_group) là «chỉ lưu». Dùng làm `AND NOT ${...}` để bỏ qua
 * khỏi xử lý tự động, hoặc `AND ${...}` để chọn riêng các cuộc chỉ lưu.
 */
export function collectOnlyThreadSql(alias = "g"): string {
  return `(CASE WHEN ${alias}.thread_type = ${ConversationType.Direct}
      THEN EXISTS (SELECT 1 FROM bot_account cod WHERE cod.id = ${alias}.owner_bot_id AND cod.kind = ${BotAccountKind.Normal})
      ELSE (${BOT_IN_GROUP(alias, BotAccountKind.Normal, false)} AND NOT ${BOT_IN_GROUP(alias, BotAccountKind.Assistant, true)})
    END)`;
}

/** Điều kiện «được xử lý tự động» = phủ định của «chỉ lưu». */
export function processableThreadSql(alias = "g"): string {
  return `NOT ${collectOnlyThreadSql(alias)}`;
}

/** Một cuộc có «chỉ lưu» không (đọc DB). Cuộc không tồn tại = false. */
export async function isCollectOnlyThread(db: Db, threadId: number): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${collectOnlyThreadSql("g")} AS collect_only FROM zalo_group g WHERE g.id = ?`, [threadId]);
  return Boolean(rows[0] && Number(rows[0].collect_only));
}
