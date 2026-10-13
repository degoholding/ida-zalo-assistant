import type { RowDataPacket } from "mysql2";
import { foldText } from "../alerts/keyword-matcher.js";
import { CatalogKind } from "../constants.js";
import type { Db } from "../db/pool.js";

// Khớp «tên / mã nhân viên» trong bảng với danh mục (catalog_entry loại nhân viên). Nạp danh mục MỘT lần mỗi lượt đọc.

export interface StaffEntry {
  id: number;
  code: string;
  name: string;
  region: string;
  expectsReport: boolean;
}

export interface StaffIndex {
  byCode: Map<string, StaffEntry>;
  /** Tên gấp dấu → nhân viên; null = trùng tên (không đoán) */
  byName: Map<string, StaffEntry | null>;
  size: number;
}

export interface ResolvedStaff {
  staffKey: string;
  staffName: string;
  catalogEntryId: number | null;
  /** Vùng của nhân viên trong danh mục — dùng khi bảng không có cột khu vực */
  region: string;
  /** Có danh mục nhân viên mà không khớp được ai → cờ UnknownStaff */
  unknown: boolean;
}

const foldKey = (value: string) => foldText(value).trim();

export function buildStaffIndex(entries: StaffEntry[]): StaffIndex {
  const byCode = new Map<string, StaffEntry>();
  const byName = new Map<string, StaffEntry | null>();
  for (const entry of entries) {
    byCode.set(foldKey(entry.code), entry);
    const name = foldKey(entry.name);
    byName.set(name, byName.has(name) ? null : entry);
  }
  return { byCode, byName, size: entries.length };
}

export async function loadStaffIndex(db: Db, tenantId = 1): Promise<StaffIndex> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id, code, name, region, expects_report FROM catalog_entry WHERE tenant_id = ? AND kind = ?",
    [tenantId, CatalogKind.Staff],
  );
  return buildStaffIndex(rows.map((row) => ({
    id: Number(row.id), code: String(row.code), name: String(row.name), region: String(row.region ?? ""), expectsReport: Boolean(row.expects_report),
  })));
}

/** `by` = cột bảng chứa mã hay tên. Khóa không khớp: «n:<tên gấp dấu>» (cắt 78 ký tự cho vừa VARCHAR(80)). */
export function resolveStaff(index: StaffIndex, cell: string, by: "name" | "code"): ResolvedStaff {
  const label = cell.trim();
  const folded = foldKey(label);
  const entry = by === "code" ? index.byCode.get(folded) : index.byName.get(folded) ?? undefined;
  if (entry) return { staffKey: `e:${entry.id}`, staffName: entry.name, catalogEntryId: entry.id, region: entry.region, unknown: false };
  return { staffKey: `n:${folded}`.slice(0, 80), staffName: label.slice(0, 150), catalogEntryId: null, region: "", unknown: index.size > 0 };
}
