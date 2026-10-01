import type http from "node:http";

// Phong bì JSON giống ERP v2 — giao diện `web/` (chép khung từ ERP) bóc phong bì này ở `core/api`:
//   thành công: { success: true, message, data }
//   thất bại:   { success: false, error: { code, message, details? } }

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function sendOk(response: http.ServerResponse, data: unknown, message = "OK", status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify({ success: true, message, data }));
}

export function sendFail(response: http.ServerResponse, error: ApiError): void {
  response.writeHead(error.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify({
    success: false,
    error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
  }));
}

const MAX_JSON_BYTES = 256 * 1024;

/** Đọc thân JSON; sai định dạng / quá cỡ → 400 / 413, không để lọt thành 500. */
export async function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_JSON_BYTES) throw new ApiError(413, "payload_too_large", "Dữ liệu gửi lên quá lớn");
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("không phải object");
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json", "Dữ liệu gửi lên không phải JSON hợp lệ");
  }
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Đọc thân nhị phân (tải tệp lên) — quá cỡ thì 413 ngay, không nuốt hết rồi mới báo. */
export async function readRawBody(request: http.IncomingMessage, maxBytes = MAX_UPLOAD_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new ApiError(413, "payload_too_large", `Tệp quá lớn — tối đa ${Math.round(maxBytes / 1024 / 1024)} MB`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Số nguyên dương từ đường dẫn (`/api/contacts/12`) — sai thì 404 chứ không truy vấn với NaN. */
export function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(404, "not_found", "Không tìm thấy bản ghi");
  return id;
}
