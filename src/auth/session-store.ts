import crypto from "node:crypto";
import type { RowDataPacket } from "mysql2";
import type { Db } from "../db/pool.js";

// Phiên đăng nhập web (phase 4): lưu CSDL (bảng web_session) để deploy / khởi động lại không văng mọi người. Chỉ lưu
// băm SHA-256 của mã phiên — lộ bảng cũng không dùng được. Mật khẩu quản trị vẫn khóa 5 lần sai / 15 phút theo máy.

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
export const SESSION_COOKIE = "bot_tro_ly_admin";
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

const hashOf = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export interface SessionInfo {
  /** null = phiên mật khẩu quản trị */
  userId: number | null;
}

export class SessionStore {
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly db: Db, private readonly adminPassword: string) {}

  isLocked(clientKey: string): boolean {
    return this.recentFailures(clientKey).length >= MAX_FAILURES;
  }

  /** Đúng mật khẩu quản trị → mã phiên; sai thì ghi một lần thất bại cho máy đó. */
  async loginWithPassword(clientKey: string, password: string): Promise<string | null> {
    if (this.isLocked(clientKey)) return null;
    const expected = crypto.createHash("sha256").update(this.adminPassword).digest();
    const given = crypto.createHash("sha256").update(password).digest();
    // So bằng thời gian cố định — không để lộ mật khẩu đúng bao nhiêu ký tự đầu
    if (!crypto.timingSafeEqual(expected, given)) {
      this.failures.set(clientKey, [...this.recentFailures(clientKey), Date.now()]);
      return null;
    }
    this.failures.delete(clientKey);
    return this.create(null);
  }

  /** Tạo phiên cho một người dùng (đã xác thực Google) hoặc quản trị (null). */
  async create(userId: number | null): Promise<string> {
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
      "SELECT user_id FROM web_session WHERE token_hash = ? AND expires_at > NOW(3)", [hashOf(token)]);
    if (!rows[0]) return null;
    return { userId: rows[0].user_id === null ? null : Number(rows[0].user_id) };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.db.query("DELETE FROM web_session WHERE token_hash = ?", [hashOf(token)]);
  }

  /** Tắt / đổi vai trò người dùng → đá mọi phiên của người đó ngay. */
  async revokeUser(userId: number): Promise<void> {
    await this.db.query("DELETE FROM web_session WHERE user_id = ?", [userId]);
  }

  private recentFailures(clientKey: string): number[] {
    const since = Date.now() - LOCK_WINDOW_MS;
    return (this.failures.get(clientKey) ?? []).filter((at) => at > since);
  }
}
