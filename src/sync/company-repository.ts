import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";

export interface CompanyRow {
  id: number;
  code: string;
  name: string;
  is_active: number;
}

// Mã công ty dùng trong dòng lệnh và cấu hình — chữ không dấu, viết hoa
export const COMPANY_CODE_PATTERN = /^[A-Z0-9_-]{1,30}$/;

export function normalizeCompanyCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export async function listCompanies(db: Db, onlyActive = false): Promise<CompanyRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, code, name, is_active FROM company ${onlyActive ? "WHERE is_active = 1" : ""} ORDER BY name`,
  );
  return rows as CompanyRow[];
}

export async function findCompanyByCode(db: Db, code: string): Promise<CompanyRow | null> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT id, code, name, is_active FROM company WHERE code = ?", [
    normalizeCompanyCode(code),
  ]);
  return (rows[0] as CompanyRow | undefined) ?? null;
}

export class CompanyInputError extends Error {}

export async function createCompany(db: Db, rawCode: string, rawName: string): Promise<number> {
  const code = normalizeCompanyCode(rawCode);
  const name = rawName.trim();
  if (!COMPANY_CODE_PATTERN.test(code)) {
    throw new CompanyInputError("Mã công ty chỉ gồm chữ không dấu, số, gạch ngang, gạch dưới (tối đa 30 ký tự)");
  }
  if (!name || name.length > 255) throw new CompanyInputError("Tên công ty không được trống, tối đa 255 ký tự");
  if (await findCompanyByCode(db, code)) throw new CompanyInputError(`Đã có công ty mã ${code}`);
  const [result] = await db.query<ResultSetHeader>("INSERT INTO company (code, name) VALUES (?, ?)", [code, name]);
  return result.insertId;
}

export async function updateCompany(db: Db, companyId: number, name: string, isActive: boolean): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 255) throw new CompanyInputError("Tên công ty không được trống, tối đa 255 ký tự");
  await db.query("UPDATE company SET name = ?, is_active = ? WHERE id = ?", [trimmed, isActive ? 1 : 0, companyId]);
}
