// Dịch lỗi Google thành câu cho quản trị — phần đáng giá nhất của nút «Kiểm tra kết nối»: câu báo phải
// nói đúng việc cần làm (số bước khớp «Hướng dẫn 5 bước» trên màn Cài đặt).

/** Lỗi đã dịch sẵn thành câu dễ hiểu — nơi gọi đưa thẳng `message` ra giao diện. */
export class GoogleSheetsError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
    this.name = "GoogleSheetsError";
  }
}

export const NETWORK_ERROR_TEXT = "Không gọi được Google (mạng / tường lửa của máy chủ).";
export const INVALID_GRANT_TEXT =
  "Khóa service account bị từ chối — khóa đã bị xóa trên Google Cloud, hoặc đồng hồ máy chủ lệch giờ. Tạo khóa mới rồi dán lại.";
export const SERVICE_DISABLED_TEXT = "Project chưa bật Google Sheets API — làm bước 2 trong hướng dẫn.";
export const NOT_FOUND_TEXT = "Không tìm thấy trang tính — kiểm tra lại link.";
export const RATE_LIMIT_TEXT = "Google đang giới hạn số lần gọi — thử lại sau một phút.";

export function permissionDeniedText(clientEmail: string): string {
  return `Trang tính chưa chia sẻ cho ${clientEmail} (quyền Người chỉnh sửa) — làm bước 5.`;
}

interface GoogleErrorBody {
  error?: string | { status?: string; message?: string; details?: { reason?: string }[] };
  error_description?: string;
}

/** Lỗi khi đổi JWT lấy access token (oauth2.googleapis.com/token). */
export function describeTokenFailure(status: number, body: GoogleErrorBody | null): GoogleSheetsError {
  const code = typeof body?.error === "string" ? body.error : "";
  if (code === "invalid_grant") return new GoogleSheetsError(INVALID_GRANT_TEXT, status);
  if (status === 429) return new GoogleSheetsError(RATE_LIMIT_TEXT, status);
  const detail = body?.error_description || code || `mã ${status}`;
  return new GoogleSheetsError(`Google từ chối khóa service account (${detail}). Tạo khóa mới rồi dán lại.`, status);
}

/** Lỗi từ Sheets API v4. */
export function describeSheetsFailure(status: number, body: GoogleErrorBody | null, clientEmail: string): GoogleSheetsError {
  const error = body && typeof body.error === "object" ? body.error : undefined;
  const message = error?.message ?? "";
  const serviceDisabled = error?.details?.some((detail) => detail.reason === "SERVICE_DISABLED")
    || /has not been used in project|is disabled/i.test(message);
  if (status === 403 && serviceDisabled) return new GoogleSheetsError(SERVICE_DISABLED_TEXT, status);
  if (status === 403) return new GoogleSheetsError(permissionDeniedText(clientEmail), status);
  if (status === 404) return new GoogleSheetsError(NOT_FOUND_TEXT, status);
  if (status === 429) return new GoogleSheetsError(RATE_LIMIT_TEXT, status);
  return new GoogleSheetsError(`Google báo lỗi ${status}${message ? `: ${message.slice(0, 200)}` : ""}`, status);
}
