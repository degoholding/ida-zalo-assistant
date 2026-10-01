import crypto from "node:crypto";

// Phiên Zalo (cookie + imei) là chìa khóa tài khoản — lộ ra là người khác đăng nhập được.
// Lưu xuống DB bằng AES-256-GCM; khóa nằm ở biến môi trường, không nằm trong DB.

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const VERSION = "v1";

function readKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("SESSION_ENCRYPTION_KEY phải là 32 byte mã base64 (tạo: npm run cli -- gen-key)");
  }
  return key;
}

export function generateKey(): string {
  return crypto.randomBytes(32).toString("base64");
}

export function encryptJson(value: unknown, base64Key: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, readKey(base64Key), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), body.toString("base64")].join(".");
}

export function decryptJson<T>(payload: string, base64Key: string): T {
  const [version, iv, tag, body] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !body) throw new Error("Chuỗi phiên mã hóa sai định dạng");
  const decipher = crypto.createDecipheriv(ALGORITHM, readKey(base64Key), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as T;
}
