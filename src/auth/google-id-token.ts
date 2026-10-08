// Kiểm «credential» (ID token) mà nút «Đăng nhập bằng Google» (Google Identity Services) trả về trình duyệt — cùng cách
// ERP v2 đăng nhập Google (bao-CR-406). Hỏi thẳng Google (tokeninfo) thay vì tự kiểm chữ ký: một lần mỗi lần đăng nhập,
// không phải giữ bộ khóa công khai. Bắt buộc: đúng client id của mình (aud), đúng Google phát (iss), email đã xác minh,
// chưa hết hạn.

const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export class GoogleTokenError extends Error {}

export interface GoogleIdentity {
  email: string;
  name: string;
  sub: string;
}

export async function verifyGoogleIdToken(credential: string, clientId: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<GoogleIdentity> {
  if (!clientId) throw new GoogleTokenError("Chưa cấu hình Client ID đăng nhập Google");
  if (!credential || credential.length > 5000 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(credential)) throw new GoogleTokenError("Mã đăng nhập Google không hợp lệ");
  const response = await fetcher(`${TOKENINFO_URL}?id_token=${encodeURIComponent(credential)}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new GoogleTokenError("Google không xác nhận mã đăng nhập (hết hạn hoặc sai)");
  const info = await response.json() as Record<string, unknown>;
  if (info.aud !== clientId) throw new GoogleTokenError("Mã đăng nhập không phải của ứng dụng này");
  if (!ISSUERS.has(String(info.iss))) throw new GoogleTokenError("Mã đăng nhập không do Google phát");
  if (Number(info.exp) * 1000 < now) throw new GoogleTokenError("Mã đăng nhập Google đã hết hạn");
  const verified = info.email_verified === true || info.email_verified === "true";
  const email = typeof info.email === "string" ? info.email.trim().toLowerCase() : "";
  if (!email || !verified) throw new GoogleTokenError("Tài khoản Google chưa xác minh email");
  return { email, name: typeof info.name === "string" ? info.name : "", sub: String(info.sub ?? "") };
}
