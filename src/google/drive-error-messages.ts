import { ApiError } from "../web/api/api-http.js";
import { GoogleSheetsError } from "./sheets-error-messages.js";

// Dịch lỗi Google Drive API v3 ra câu tiếng Việt + phân tích link thư mục (phase recap họp, 10/10/2026).
// Drive dùng CHUNG tài khoản Google đã «Kết nối Google» (Gmail riêng của bot, OAuth người dùng) — KHÔNG có service
// account, KHÔNG có bước chia sẻ thư mục: thư mục «Ghi âm họp» nằm sẵn trong Drive của chính Gmail đó.

export const NOT_A_FOLDER_TEXT = "Đây không phải thư mục Drive — dán link một THƯ MỤC, không phải một tệp.";
export const DRIVE_API_DISABLED_TEXT =
  "Project của Client ID (Kết nối Google) chưa bật Google Drive API — vào Google Cloud Console → APIs & Services → " +
  "Library → tìm Google Drive API → Enable (project này đã bật Google Calendar API), đợi vài phút rồi kiểm tra lại.";
export const FOLDER_NOT_FOUND_TEXT =
  "Không thấy thư mục này trong Drive của tài khoản đã kết nối — kiểm tra lại link, hoặc thư mục thuộc Drive của tài khoản Google khác.";
export const FOLDER_LINK_INVALID_TEXT = "Link thư mục không đúng — mở thư mục trên Drive, chép link trên thanh địa chỉ.";
export const RECONNECT_DRIVE_TEXT = "Kết nối Google không còn hiệu lực — vào Cài đặt → Google bấm «Kết nối Google» lại.";

interface GoogleErrorBody {
  error?: {
    status?: string;
    message?: string;
    details?: { reason?: string }[];
    errors?: { reason?: string; message?: string }[];
  };
}

function reasonOf(body: GoogleErrorBody | null): string {
  const error = body?.error;
  if (!error || typeof error !== "object") return "";
  return error.details?.[0]?.reason || error.errors?.[0]?.reason || "";
}

/** Lỗi từ Drive API v3 — gọi bằng access token OAuth của Gmail đã kết nối (không phải service account). */
export function describeDriveFailure(status: number, body: GoogleErrorBody | null): GoogleSheetsError {
  const message = body?.error?.message ?? "";
  const reason = reasonOf(body);
  const serviceDisabled = reason === "SERVICE_DISABLED" || /has not been used in project|is disabled/i.test(message);
  if (status === 403 && serviceDisabled) return new GoogleSheetsError(DRIVE_API_DISABLED_TEXT, status);
  if (status === 401) return new GoogleSheetsError(RECONNECT_DRIVE_TEXT, status);
  // 404 (không thấy) hoặc 403 (không có quyền trên đúng tệp/thư mục này) đều gặp khi link sai Drive / đã bị xóa
  if (status === 404 || status === 403) return new GoogleSheetsError(FOLDER_NOT_FOUND_TEXT, status);
  return new GoogleSheetsError(`Google Drive báo lỗi ${status}${message ? `: ${message.slice(0, 200)}` : ""}`, status);
}

// `…/drive/folders/<id>` hoặc `…/drive/u/0/folders/<id>`; id Drive thường 25-44 ký tự nhưng không có độ dài cố định.
const FOLDER_URL_PATTERN = /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,100})/;
const FOLDER_ID_QUERY_PATTERN = /[?&]id=([A-Za-z0-9_-]{10,100})/;
const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/;

/** Nhận link đầy đủ (`…/drive/folders/<id>`, `…/drive/u/0/folders/<id>`, `?id=<id>`) hoặc id trần. */
export function parseDriveFolderId(input: string): string {
  const text = input.trim();
  if (!text) throw new ApiError(422, "validation_error", "Chưa có link thư mục");
  if (/^https?:\/\//i.test(text)) {
    const folderMatch = FOLDER_URL_PATTERN.exec(text);
    if (folderMatch) return folderMatch[1];
    const idMatch = FOLDER_ID_QUERY_PATTERN.exec(text);
    if (idMatch) return idMatch[1];
    throw new ApiError(422, "validation_error", FOLDER_LINK_INVALID_TEXT);
  }
  if (!FOLDER_ID_PATTERN.test(text)) throw new ApiError(422, "validation_error", FOLDER_LINK_INVALID_TEXT);
  return text;
}
