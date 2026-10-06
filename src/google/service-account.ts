import { ApiError } from "../web/api/api-http.js";

// Đọc tệp khóa service account Google (quản trị dán nguyên nội dung JSON vào màn Cài đặt) và link
// trang tính. Hàm thuần — sai thì báo 422 bằng câu nói rõ phải làm gì.

export const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const CLIENT_EMAIL_SUFFIX = ".iam.gserviceaccount.com";
const PRIVATE_KEY_HEADER = "-----BEGIN PRIVATE KEY-----";
const SPREADSHEET_ID_PATTERN = /^[A-Za-z0-9_-]{25,60}$/;

/** Phần cần giữ của tệp khóa — bỏ các trường còn lại cho gọn. */
export interface ServiceAccount {
  type: "service_account";
  client_email: string;
  private_key: string;
  token_uri: string;
  project_id: string;
}

function invalid(reason: string): ApiError {
  return new ApiError(422, "validation_error", `Đây không phải tệp khóa service account — ${reason}`);
}

/** Nhận chuỗi JSON hoặc object; trả về bản đã chuẩn hóa (khóa riêng có xuống dòng thật). */
export function parseServiceAccount(raw: unknown): ServiceAccount {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      throw invalid("nội dung không phải JSON hợp lệ (dán nguyên cả tệp .json, gồm cả dấu { })");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("nội dung không phải một object JSON");
  const source = value as Record<string, unknown>;
  // Hay gặp (06/10/2026): dán tệp OAuth client (khóa «web» / «installed») vào ô service account — chỉ đúng ô cần dán
  if (source.web || source.installed) {
    throw new ApiError(422, "validation_error", "Đây là tệp OAuth client, không phải khóa service account — không cần dán tệp này: chỉ chép Client ID và Client secret vào hai ô «Kết nối Google» bên dưới");
  }
  if (source.type !== "service_account") throw invalid('trường "type" phải là "service_account"');
  const clientEmail = typeof source.client_email === "string" ? source.client_email.trim() : "";
  if (!clientEmail) throw invalid("thiếu client_email");
  if (!clientEmail.endsWith(CLIENT_EMAIL_SUFFIX)) throw invalid(`client_email phải có đuôi ${CLIENT_EMAIL_SUFFIX}`);
  // Dán qua vài trình soạn thảo làm xuống dòng bị thoát thành "\\n" — đổi lại cho khóa đọc được
  const privateKey = typeof source.private_key === "string" ? source.private_key.replace(/\\n/g, "\n") : "";
  if (!privateKey) throw invalid("thiếu private_key");
  if (!privateKey.trimStart().startsWith(PRIVATE_KEY_HEADER)) throw invalid(`private_key phải bắt đầu bằng ${PRIVATE_KEY_HEADER}`);
  const tokenUri = typeof source.token_uri === "string" && source.token_uri.trim() ? source.token_uri.trim() : DEFAULT_TOKEN_URI;
  if (!tokenUri.startsWith("https://")) throw invalid("token_uri phải là địa chỉ https");
  return {
    type: "service_account",
    client_email: clientEmail,
    private_key: privateKey,
    token_uri: tokenUri,
    project_id: typeof source.project_id === "string" ? source.project_id : "",
  };
}

/** Nhận link đầy đủ (`…/spreadsheets/d/<id>/edit#gid=0`) hoặc id trần. */
export function parseSpreadsheetId(input: string): string {
  const text = input.trim();
  if (!text) throw new ApiError(422, "validation_error", "Chưa có link trang tính");
  if (/^https?:\/\//i.test(text)) {
    const match = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(text);
    if (!match) throw new ApiError(422, "validation_error", "Link không phải Google Sheets — cần dạng https://docs.google.com/spreadsheets/d/…");
    if (!SPREADSHEET_ID_PATTERN.test(match[1])) throw new ApiError(422, "validation_error", "Mã trang tính trong link không đúng");
    return match[1];
  }
  if (!SPREADSHEET_ID_PATTERN.test(text)) {
    throw new ApiError(422, "validation_error", "Link trang tính không đúng — dán link https://docs.google.com/spreadsheets/d/… hoặc mã trang tính");
  }
  return text;
}
