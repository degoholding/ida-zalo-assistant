import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { CatalogMatchStatus } from "../constants.js";
import type { Db } from "../db/pool.js";
import type { MatchCandidate, MatchContact, ParsedCatalogEntry } from "./catalog-types.js";

// Đọc / ghi bảng catalog_entry. Khóa nạp lại: (tenant_id, kind, code).

export const CATALOG_TENANT_ID = 1;

export interface CatalogEntryRow {
  id: number;
  kind: number;
  name: string;
  phone: string;
  contactId: number | null;
  matchStatus: number;
}

/**
 * Thêm mới hoặc cập nhật từng dòng; KHÔNG đụng contact_id. match_status chỉ đổi một ca: mục quản trị đã «Bỏ gắn» (Unlinked) mà tệp
 * mới mang SĐT KHÁC thì về Unmatched để khớp lại theo SĐT mới. Trả số dòng mới / cập nhật.
 */
export async function upsertCatalogEntries(db: Db, entries: ParsedCatalogEntry[]): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const entry of entries) {
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO catalog_entry (tenant_id, kind, code, name, phone, region, sales_zone, owner_code, extra, is_active, expects_report, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE
         match_status = IF(match_status = ${CatalogMatchStatus.Unlinked} AND VALUES(phone) <> '' AND VALUES(phone) <> phone, ${CatalogMatchStatus.Unmatched}, match_status),
         name = VALUES(name), phone = VALUES(phone), region = VALUES(region), sales_zone = VALUES(sales_zone),
         owner_code = VALUES(owner_code), extra = VALUES(extra), is_active = VALUES(is_active), expects_report = VALUES(expects_report),
         imported_at = NOW(3)`,
      [CATALOG_TENANT_ID, entry.kind, entry.code, entry.name, entry.phone, entry.region, entry.salesZone, entry.ownerCode,
        JSON.stringify(entry.extra), entry.isActive ? 1 : 0, entry.expectsReport ? 1 : 0],
    );
    if (result.affectedRows === 1) created += 1;
    else updated += 1;
  }
  return { created, updated };
}

/** Giải owner_entry_id theo owner_code (người phụ trách / quản lý luôn là nhân viên); không thấy mã → NULL. */
export async function resolveCatalogOwners(db: Db): Promise<void> {
  await db.query(
    `UPDATE catalog_entry e LEFT JOIN catalog_entry o ON o.tenant_id = e.tenant_id AND o.kind = 1 AND o.code = e.owner_code AND o.id <> e.id
     SET e.owner_entry_id = o.id WHERE e.tenant_id = ?`, [CATALOG_TENANT_ID]);
}

export async function loadMatchContacts(db: Db): Promise<MatchContact[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, COALESCE(NULLIF(display_name, ''), zalo_name) AS name, kind, COALESCE(phone, '') AS phone FROM contact");
  return rows.map((row) => ({ id: Number(row.id), name: String(row.name ?? ""), kind: Number(row.kind), phone: String(row.phone) }));
}

/** Liên hệ đã gắn vào mục Confirmed — không bao giờ bị khớp lại cho mục khác. */
export async function loadConfirmedContactIds(db: Db): Promise<Set<number>> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT contact_id FROM catalog_entry WHERE tenant_id = ? AND match_status = ? AND contact_id IS NOT NULL", [CATALOG_TENANT_ID, CatalogMatchStatus.Confirmed]);
  return new Set(rows.map((row) => Number(row.contact_id)));
}

/** Trạng thái khớp tự động KHÔNG đụng tới: quản trị đã chọn (Confirmed) hoặc đã bỏ gắn (Unlinked). */
const MANUAL_STATUSES = [CatalogMatchStatus.Confirmed, CatalogMatchStatus.Unlinked];

/** Mục khớp tự động được (chưa Confirmed / Unlinked), theo id. */
export async function loadUnconfirmedEntries(db: Db): Promise<CatalogEntryRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, kind, name, phone, contact_id, match_status FROM catalog_entry WHERE tenant_id = ? AND match_status NOT IN (?) ORDER BY id",
    [CATALOG_TENANT_ID, MANUAL_STATUSES]);
  return rows.map((row) => ({
    id: Number(row.id), kind: Number(row.kind), name: String(row.name), phone: String(row.phone),
    contactId: row.contact_id === null ? null : Number(row.contact_id), matchStatus: Number(row.match_status),
  }));
}

/** Gỡ liên kết của mọi mục khớp tự động (chuẩn bị khớp lại từ đầu) — mục Confirmed / Unlinked giữ nguyên. */
export async function clearUnconfirmedMatches(db: Db): Promise<void> {
  await db.query(
    "UPDATE catalog_entry SET contact_id = NULL, match_status = ?, match_candidates = NULL WHERE tenant_id = ? AND match_status NOT IN (?)",
    [CatalogMatchStatus.Unmatched, CATALOG_TENANT_ID, MANUAL_STATUSES]);
}

export async function writeCatalogMatch(
  db: Db, entryId: number, match: { status: CatalogMatchStatus; contactId: number | null; candidates: MatchCandidate[] },
): Promise<void> {
  await db.query("UPDATE catalog_entry SET match_status = ?, contact_id = ?, match_candidates = ? WHERE id = ?", [
    match.status, match.contactId, match.candidates.length ? JSON.stringify(match.candidates) : null, entryId,
  ]);
}

export async function findCatalogEntry(db: Db, id: number): Promise<CatalogEntryRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, kind, name, phone, contact_id, match_status FROM catalog_entry WHERE id = ? AND tenant_id = ?", [id, CATALOG_TENANT_ID]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id), kind: Number(row.kind), name: String(row.name), phone: String(row.phone),
    contactId: row.contact_id === null ? null : Number(row.contact_id), matchStatus: Number(row.match_status),
  };
}
