import type { RowDataPacket } from "mysql2";
import { ContactKind } from "../constants.js";
import type { Db } from "../db/pool.js";

// Tìm người trong Danh bạ theo tên người dùng gõ («Minh», «anh Nam») — dùng chung cho «thêm vip <tên>» và «giao <tên>: …».
// Không phân biệt dấu / hoa thường (collation của bảng). Xếp: ở nhóm đang nói trước, khớp đúng tên trước, người từng nhắn
// bot trước. Không bao giờ trả tài khoản bot.

export interface ContactMatch {
  id: number;
  uid: string;
  name: string;
  kind: number;
  exact: boolean;
  /** Đang ở nhóm `groupId` (khi có truyền) */
  inGroup: boolean;
}

export interface ContactSearchOptions {
  /** Ưu tiên (và khớp cả tên hiển thị trong) nhóm này */
  groupId?: number | null;
  /** Chỉ trong VIP của người nhận này */
  vipOfRecipientId?: number;
  limit?: number;
}

/** Bỏ «anh / chị / em / @» đầu tên người dùng hay gõ kèm. Hàm thuần. */
export function cleanPersonName(raw: string): string {
  return raw.normalize("NFC").replace(/^@/, "").replace(/^(anh|chị|chi|em|cô|co|chú|chu|bác|bac|bạn|ban|a|c|e)\s+(?=\S)/iu, "").replace(/^@/, "").trim();
}

/** Tên đúng như người gõ (nơi gọi tự quyết có bỏ xưng hô không — «Anh Thư» là tên thật). */
export async function searchContactsByName(db: Db, rawName: string, options: ContactSearchOptions = {}): Promise<ContactMatch[]> {
  const name = rawName.normalize("NFC").trim();
  if (!name) return [];
  const like = `%${name.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
  const groupId = options.groupId ?? null;
  const memberOf = "EXISTS (SELECT 1 FROM group_member gm WHERE gm.group_id = ? AND gm.zalo_uid = c.zalo_uid AND gm.left_at IS NULL";
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT c.id, c.zalo_uid, COALESCE(NULLIF(c.display_name, ''), c.zalo_name) AS name, c.kind,
            (COALESCE(NULLIF(c.display_name, ''), c.zalo_name) = ?) AS exact,
            ${groupId ? `${memberOf})` : "0"} AS in_group
     FROM contact c
     WHERE (c.display_name LIKE ? OR c.zalo_name LIKE ? ${groupId ? `OR ${memberOf} AND gm.display_name LIKE ?)` : ""})
       AND c.zalo_uid NOT IN (SELECT zalo_uid FROM bot_account WHERE zalo_uid IS NOT NULL)
       ${options.vipOfRecipientId ? "AND c.id IN (SELECT contact_id FROM recipient_vip WHERE recipient_id = ?)" : ""}
     ORDER BY in_group DESC, exact DESC, c.last_dm_at IS NULL, name LIMIT ?`,
    [name, ...(groupId ? [groupId] : []), like, like, ...(groupId ? [groupId, like] : []),
      ...(options.vipOfRecipientId ? [options.vipOfRecipientId] : []), options.limit ?? 8]);
  return rows.map((row) => ({
    id: Number(row.id), uid: String(row.zalo_uid), name: String(row.name ?? ""), kind: Number(row.kind),
    exact: Number(row.exact) === 1, inGroup: Number(row.in_group) === 1,
  }));
}

/** «Có 3 người khớp «Minh»: 1. … (nhân sự) 2. …» + cách nhắn lại — khi pickContactMatch không chọn được. Hàm thuần. */
export function describeContactChoices(rows: { name: string; kind: number }[], name: string, retryHint: string): string {
  const kindLabel = (kind: number) => (kind === ContactKind.Customer ? "khách" : kind === ContactKind.Staff ? "nhân sự" : "chưa phân loại");
  return [`Có ${rows.length}${rows.length === 8 ? "+" : ""} người khớp «${name}»:`,
    ...rows.map((row, index) => `${index + 1}. ${row.name} (${kindLabel(row.kind)})`),
    `Anh/chị nhắn lại «${retryHint}» giúp em.`].join("\n");
}

/**
 * Chọn đúng MỘT người nếu rõ ràng: chỉ một người khớp; hoặc (trong số người ở nhóm, nếu có) chỉ một người khớp đúng tên /
 * chỉ một người ở nhóm. Không rõ thì null — nơi gọi đưa danh sách cho người dùng chọn. Hàm thuần.
 */
export function pickContactMatch(matches: ContactMatch[]): ContactMatch | null {
  if (matches.length === 1) return matches[0];
  const pool = matches.some((match) => match.inGroup) ? matches.filter((match) => match.inGroup) : matches;
  if (pool.length === 1) return pool[0];
  const exact = pool.filter((match) => match.exact);
  return exact.length === 1 ? exact[0] : null;
}
