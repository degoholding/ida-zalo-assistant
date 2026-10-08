import fs from "node:fs";
import type { RowDataPacket } from "mysql2";
import { UserRole } from "../constants.js";
import type { Db } from "../db/pool.js";
import { hashPassword } from "./password.js";

// Việc quản trị tài khoản web từ DÒNG LỆNH (không cần đăng nhập web): đặt lại mật khẩu khi quên / khóa, tạo tài khoản
// quản trị đầu tiên, nạp danh sách người dùng từ tệp. Từ 08/10/2026 không còn mật khẩu quản trị chung — đây là đường
// cứu khi không còn ai vào được màn Người dùng.

/** Đặt mật khẩu cho tài khoản theo tên đăng nhập / email; bật lại tài khoản; đá phiên cũ. */
export async function setUserPassword(db: Db, login: string, password: string): Promise<number> {
  const key = login.trim().toLowerCase();
  const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM app_user WHERE username = ? OR email = ? LIMIT 1", [key, key]);
  if (!rows[0]) throw new Error(`Không có tài khoản «${key}»`);
  const id = Number(rows[0].id);
  await db.query("UPDATE app_user SET password_hash = ?, is_active = 1 WHERE id = ?", [await hashPassword(password), id]);
  await db.query("DELETE FROM web_session WHERE user_id = ?", [id]);
  return id;
}

/** Có tài khoản tên này thì nâng lên quản trị + đặt mật khẩu; chưa có thì tạo. */
export async function ensureAdminUser(db: Db, username: string, password: string, fullName = "Quản trị"): Promise<{ id: number; created: boolean }> {
  const key = username.trim().toLowerCase();
  const hash = await hashPassword(password);
  const [rows] = await db.query<RowDataPacket[]>("SELECT id FROM app_user WHERE username = ?", [key]);
  if (rows[0]) {
    const id = Number(rows[0].id);
    await db.query("UPDATE app_user SET role = ?, all_groups = 1, is_active = 1, password_hash = ? WHERE id = ?", [UserRole.Admin, hash, id]);
    await db.query("DELETE FROM web_session WHERE user_id = ?", [id]);
    return { id, created: false };
  }
  const [result] = await db.query<any>(
    "INSERT INTO app_user (username, password_hash, full_name, role, all_groups, is_active) VALUES (?, ?, ?, ?, 1, 1)",
    [key, hash, fullName, UserRole.Admin]);
  return { id: Number(result.insertId), created: true };
}

export interface ImportUsersResult {
  created: number;
  skipped: number;
}

/**
 * Nạp người dùng từ tệp TSV «email<TAB>họ tên» (dòng trống / dòng # bỏ qua). Mỗi người: tên đăng nhập = email, mật khẩu
 * = email (đại ca chốt 08/10/2026), vai trò `role`, thấy mọi nhóm. Email đã có tài khoản thì bỏ qua (không ghi đè).
 */
export async function importUsersFromTsv(db: Db, path: string, role: UserRole): Promise<ImportUsersResult> {
  const result: ImportUsersResult = { created: 0, skipped: 0 };
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [rawEmail, rawName = ""] = line.split("\t");
    const email = rawEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
      result.skipped += 1;
      continue;
    }
    const [existing] = await db.query<RowDataPacket[]>("SELECT id FROM app_user WHERE email = ? OR username = ?", [email, email]);
    if (existing[0]) {
      result.skipped += 1;
      continue;
    }
    await db.query(
      "INSERT INTO app_user (email, username, password_hash, full_name, role, all_groups, is_active) VALUES (?, ?, ?, ?, ?, 1, 1)",
      [email, email, await hashPassword(email), rawName.trim().slice(0, 150), role]);
    result.created += 1;
  }
  return result;
}
