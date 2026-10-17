import crypto from "node:crypto";

// Định dạng + băm khóa MCP — hàm thuần, không đụng CSDL (kho khóa ở mcp-api-key-store.ts).
//   idamcp_<tiền tố 8 ký tự base62>_<bí mật 32 byte base64url = 43 ký tự>
// Tiền tố hiện trên web để nhận ra khóa; chỉ lưu SHA-256 của CẢ chuỗi. Độ dài cố định nên dấu «_» trong base64url không gây nhập nhằng.

export const MCP_KEY_LABEL = "idamcp";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const PREFIX_LENGTH = 8;
const SECRET_BYTES = 32;
const KEY_PATTERN = /^idamcp_([0-9A-Za-z]{8})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedMcpKey {
  /** Chuỗi khóa đầy đủ — chỉ trả cho người dùng MỘT lần, không lưu, không log. */
  token: string;
  prefix: string;
  tokenHash: string;
}

/** Chọn ký tự base62 đều (loại byte >= 248 để không lệch phân phối do 256 không chia hết cho 62). */
function randomBase62(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      if (byte < 248 && out.length < length) out += BASE62[byte % 62];
    }
  }
  return out;
}

export function hashMcpKey(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateMcpKey(): GeneratedMcpKey {
  const prefix = randomBase62(PREFIX_LENGTH);
  const secret = crypto.randomBytes(SECRET_BYTES).toString("base64url");
  const token = `${MCP_KEY_LABEL}_${prefix}_${secret}`;
  return { token, prefix, tokenHash: hashMcpKey(token) };
}

/** Tách khóa đúng định dạng → tiền tố + băm; sai định dạng → null (chưa cần hỏi CSDL). */
export function parseMcpKey(token: string): { prefix: string; tokenHash: string } | null {
  const match = KEY_PATTERN.exec(token.trim());
  if (!match) return null;
  return { prefix: match[1], tokenHash: hashMcpKey(token.trim()) };
}

/** Lấy khóa từ tiêu đề `Authorization: Bearer <khóa>`; thiếu / sai kiểu → null. */
export function extractBearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match ? match[1] : null;
}
