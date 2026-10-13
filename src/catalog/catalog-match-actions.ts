import type { RowDataPacket } from "mysql2";
import { CatalogKind, CatalogMatchStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import { ApiError } from "../web/api/api-http.js";
import { recordAudit } from "../web/api/audit-log.js";
import { matchCatalogEntry } from "./catalog-matcher.js";
import {
  clearUnconfirmedMatches, findCatalogEntry, loadConfirmedContactIds, loadMatchContacts, loadUnconfirmedEntries, writeCatalogMatch,
} from "./catalog-repository.js";

// Khớp / xác nhận / bỏ gắn liên hệ Zalo cho mục danh mục. Mọi thao tác ghi đều recordAudit.

export interface MatchTally {
  matched: number;
  suggested: number;
  unmatched: number;
}

/**
 * Khớp lại từ đầu mọi mục chưa do quản trị quyết (mục Confirmed giữ liên hệ; mục Unlinked — quản trị đã bỏ gắn — để yên, không tự gắn
 * lại). Một liên hệ chỉ gắn một mục.
 */
export async function runCatalogMatching(db: Db): Promise<MatchTally> {
  const tally: MatchTally = { matched: 0, suggested: 0, unmatched: 0 };
  await clearUnconfirmedMatches(db);
  const [contacts, entries, linked] = await Promise.all([loadMatchContacts(db), loadUnconfirmedEntries(db), loadConfirmedContactIds(db)]);
  for (const entry of entries) {
    const result = matchCatalogEntry({ kind: entry.kind as CatalogKind, name: entry.name, phone: entry.phone }, contacts, linked);
    await writeCatalogMatch(db, entry.id, { status: result.status, contactId: result.contactId ?? null, candidates: result.candidates });
    if (result.status === CatalogMatchStatus.Matched && result.contactId !== undefined) {
      linked.add(result.contactId);
      tally.matched += 1;
    } else if (result.status === CatalogMatchStatus.Suggested) tally.suggested += 1;
    else tally.unmatched += 1;
  }
  return tally;
}

export async function rematchAll(db: Db): Promise<MatchTally> {
  const tally = await runCatalogMatching(db);
  await recordAudit(db, {
    entity: "catalog", entityId: 0, action: "update",
    message: `Khớp lại danh mục: ${tally.matched} khớp, ${tally.suggested} gợi ý, ${tally.unmatched} chưa khớp`,
  });
  return tally;
}

/** Quản trị chọn liên hệ cho mục: liên hệ đã gắn mục khác → 409; điền SĐT của mục vào liên hệ nếu đang trống. */
export async function confirmMatch(db: Db, entryId: number, contactId: number): Promise<void> {
  const entry = await findCatalogEntry(db, entryId);
  if (!entry) throw new ApiError(404, "not_found", "Không có mục danh mục này");
  const [contacts] = await db.query<RowDataPacket[]>("SELECT id, phone FROM contact WHERE id = ?", [contactId]);
  if (!contacts[0]) throw new ApiError(404, "not_found", "Không có liên hệ này trong Danh bạ");
  const [taken] = await db.query<RowDataPacket[]>("SELECT id, name FROM catalog_entry WHERE contact_id = ? AND id <> ?", [contactId, entryId]);
  if (taken[0]) throw new ApiError(409, "conflict", `Liên hệ này đã gắn với «${String(taken[0].name)}» — bỏ gắn bên đó trước`);
  await writeCatalogMatch(db, entryId, { status: CatalogMatchStatus.Confirmed, contactId, candidates: [] });
  if (entry.phone && !contacts[0].phone) await db.query("UPDATE contact SET phone = ? WHERE id = ?", [entry.phone, contactId]);
  await recordAudit(db, { entity: "catalog", entityId: entryId, action: "update", message: `Xác nhận gắn liên hệ #${contactId}`, changedFields: ["Liên hệ Zalo"] });
}

/**
 * Bỏ gắn: mục thành Unlinked — lượt khớp tự động sau (khớp lại / nạp tệp) không gắn lại. Giữ ứng viên (gồm liên hệ vừa bỏ) để quản
 * trị chọn tay người đúng ngay ở trang chi tiết.
 */
export async function unlinkMatch(db: Db, entryId: number): Promise<void> {
  const entry = await findCatalogEntry(db, entryId);
  if (!entry) throw new ApiError(404, "not_found", "Không có mục danh mục này");
  if (entry.contactId === null) throw new ApiError(409, "conflict", "Mục này chưa gắn liên hệ nào");
  const [contacts, linked] = await Promise.all([loadMatchContacts(db), loadConfirmedContactIds(db)]);
  const result = matchCatalogEntry({ kind: entry.kind as CatalogKind, name: entry.name, phone: entry.phone }, contacts, linked);
  const found = result.status === CatalogMatchStatus.Matched && result.contactId !== undefined
    ? [{ contactId: result.contactId, name: "", score: 1 }]
    : result.candidates;
  // Liên hệ vừa bỏ luôn có trong danh sách (quản trị bấm nhầm thì chọn lại được), dù tên không còn giống
  const previous = found.some((item) => item.contactId === entry.contactId) ? [] : [{ contactId: entry.contactId, name: "", score: 0 }];
  const candidates = [...found, ...previous];
  await writeCatalogMatch(db, entryId, { status: CatalogMatchStatus.Unlinked, contactId: null, candidates });
  await recordAudit(db, { entity: "catalog", entityId: entryId, action: "update", message: `Bỏ gắn liên hệ #${entry.contactId}`, changedFields: ["Liên hệ Zalo"] });
}
