import crypto from "node:crypto";
import type { RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";
import { verifyPassword } from "./password.js";

// Phiên đăng nhập web: lưu CSDL (bảng web_session) để deploy / khởi động lại không văng mọi người. Chỉ lưu băm SHA-256
// của mã phiên — lộ bảng cũng không dùng được. Từ 08/10/2026 không còn mật khẩu quản trị chung: mỗi người đăng nhập
// bằng tên đăng nhập (hoặc email) + mật khẩu riêng, hoặc nút Google. Sai 5 lần / 15 phút thì khóa — theo MÁY và theo
// TÊN ĐĂNG NHẬP (đổi máy cũng không dò tiếp được một tài khoản).

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
export const SESSION_COOKIE = "bot_tro_ly_admin";
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

const hashOf = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export interface SessionInfo {
  userId: number;
}

export class SessionStore {
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly db: Db) {}

  isLocked(clientKey: string, login = ""): boolean {
    return this.recentFailures(`ip:${clientKey}`).length >= MAX_FAILURES
      || (Boolean(login) && this.recentFailures(`user:${login.toLowerCase()}`).length >= MAX_FAILURES);
  }

  /**
   * Tên đăng nhập (hoặc email) + mật khẩu → id người dùng, hoặc null nếu sai / tài khoản tắt / chưa đặt mật khẩu.
   * Sai thì ghi một lần thất bại cho máy và cho tên đăng nhập đó.
   */
  async verifyLogin(clientKey: string, login: string, password: string): Promise<number | null> {
    const key = login.trim().toLowerCase();
    if (!key || this.isLocked(clientKey, key)) return null;
    const [rows] = await this.db.query<RowDataPacket[]>(
      "SELECT id, password_hash FROM app_user WHERE is_active = 1 AND (username = ? OR email = ?) LIMIT 1", [key, key]);
    const ok = rows[0] ? await verifyPassword(password, rows[0].password_hash as string | null) : false;
    if (!ok) {
      const now = Date.now();
      this.failures.set(`ip:${clientKey}`, [...this.recentFailures(`ip:${clientKey}`), now]);
      this.failures.set(`user:${key}`, [...this.recentFailures(`user:${key}`), now]);
      return null;
    }
    this.failures.delete(`user:${key}`);
    return Number(rows[0].id);
  }

  async create(userId: number): Promise<string> {
    const token = crypto.randomBytes(32).toString("hex");
    await this.db.query("INSERT INTO web_session (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
      [hashOf(token), userId, new Date(Date.now() + SESSION_TTL_MS)]);
    // Dọn phiên hết hạn nhân tiện (bảng nhỏ)
    await this.db.query("DELETE FROM web_session WHERE expires_at < NOW(3) LIMIT 500");
    return token;
  }

  async resolve(token: string | undefined): Promise<SessionInfo | null> {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const [rows] = await this.db.query<RowDataPacket[]>(
      "SELECT user_id FROM web_session WHERE token_hash = ? AND expires_at > NOW(3) AND user_id IS NOT NULL", [hashOf(token)]);
    return rows[0] ? { userId: Number(rows[0].user_id) } : null;
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.db.query("DELETE FROM web_session WHERE token_hash = ?", [hashOf(token)]);
  }

  /** Tắt / đổi vai trò / đổi mật khẩu người dùng → đá mọi phiên của người đó ngay. */
  async revokeUser(userId: number): Promise<void> {
    await this.db.query("DELETE FROM web_session WHERE user_id = ?", [userId]);
  }

  private recentFailures(key: string): number[] {
    const since = Date.now() - LOCK_WINDOW_MS;
    return (this.failures.get(key) ?? []).filter((at) => at > since);
  }
}
