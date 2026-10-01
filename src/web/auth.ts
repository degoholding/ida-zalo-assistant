import crypto from "node:crypto";

// Một mật khẩu quản trị (ADMIN_PASSWORD), phiên giữ trong bộ nhớ: khởi động lại là đăng nhập lại.
// Bản đầu chỉ quản lý dùng giao diện này; tài khoản theo vai trò (trưởng phòng) làm ở phase sau.

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

export const SESSION_COOKIE = "bot_tro_ly_admin";

export class AdminAuth {
  private readonly sessions = new Map<string, number>();
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly adminPassword: string) {}

  isLocked(clientKey: string): boolean {
    return this.recentFailures(clientKey).length >= MAX_FAILURES;
  }

  /** Trả về mã phiên nếu đúng mật khẩu; sai thì ghi một lần thất bại cho máy đó. */
  login(clientKey: string, password: string): string | null {
    if (this.isLocked(clientKey)) return null;
    const expected = crypto.createHash("sha256").update(this.adminPassword).digest();
    const given = crypto.createHash("sha256").update(password).digest();
    // So bằng thời gian cố định — không để lộ mật khẩu đúng bao nhiêu ký tự đầu
    if (!crypto.timingSafeEqual(expected, given)) {
      this.failures.set(clientKey, [...this.recentFailures(clientKey), Date.now()]);
      return null;
    }
    this.failures.delete(clientKey);
    const token = crypto.randomBytes(32).toString("hex");
    this.sessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
  }

  isValid(token: string | undefined): boolean {
    if (!token) return false;
    const expiresAt = this.sessions.get(token);
    if (!expiresAt) return false;
    if (expiresAt < Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  logout(token: string | undefined): void {
    if (token) this.sessions.delete(token);
  }

  private recentFailures(clientKey: string): number[] {
    const since = Date.now() - LOCK_WINDOW_MS;
    return (this.failures.get(clientKey) ?? []).filter((at) => at > since);
  }
}
