import crypto from "node:crypto";
import { promisify } from "node:util";

// Băm mật khẩu đăng nhập web bằng scrypt (có sẵn trong Node, không thêm thư viện). Chuỗi lưu: «scrypt$N$r$p$muối$băm»
// (base64url) — đổi thông số sau này vẫn kiểm được mật khẩu cũ. So sánh bằng thời gian cố định.

const scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number, options: crypto.ScryptOptions) => Promise<Buffer>;
const KEY_LENGTH = 32;
const PARAMS = { N: 16384, r: 8, p: 1 };
/** Trần độ dài để không ai gửi chuỗi vài MB bắt máy chủ băm (tốn CPU). */
export const MAX_PASSWORD_LENGTH = 200;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || password.length > MAX_PASSWORD_LENGTH) return false;
  const [scheme, n, r, p, saltText, hashText] = stored.split("$");
  if (scheme !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = await scrypt(password, Buffer.from(saltText, "base64url"), expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
