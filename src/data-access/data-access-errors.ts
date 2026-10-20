// Lỗi của lõi truy cập dữ liệu. Cổng (MCP / trợ lý) đổi thành kết quả `isError: true` — KHÔNG ném ra ngoài giao thức,
// để mô hình đọc được mã + danh sách giá trị hợp lệ rồi tự sửa lời gọi.

export type DataAccessErrorCode =
  | "unknown_entity" | "forbidden" | "invalid_field" | "invalid_operator" | "invalid_value" | "missing_required_filter"
  | "range_too_wide" | "page_too_deep" | "not_found" | "timeout"
  // Ghi (phase 8): mã xác nhận sai / hết hạn / đã dùng (một thông báo chung); bản ghi đã đổi từ lúc nháp; thao tác không hợp trạng thái;
  // quá nhịp / quá số nháp
  | "invalid_code" | "stale_target" | "invalid_state" | "rate_limited"
  // Dùng chung cho các họ công cụ của trợ lý (phase 5): nhóm Mật trong phạm vi nhưng người hỏi chưa có cờ; tên phân giải ra nhiều người / nhóm
  // (kèm `choices`); quan hệ không đủ quyền (kèm `reason` để lớp lệnh dựng đúng câu cũ)
  | "confidential" | "ambiguous" | "not_allowed";

/** Phần kèm riêng của `ambiguous` (danh sách chọn) và `not_allowed` (lý do máy đọc được); không lộ ra cổng MCP ngoài. */
export interface DataAccessErrorDetail {
  choices?: { id: number; name: string; kind?: number }[];
  reason?: string;
}

export class DataAccessError extends Error {
  constructor(readonly code: DataAccessErrorCode, message: string, readonly allowed?: string[], readonly detail?: DataAccessErrorDetail) {
    super(message);
    this.name = "DataAccessError";
  }
}

export interface ErrorPayload {
  error: { code: DataAccessErrorCode; message: string; allowed?: string[]; choices?: DataAccessErrorDetail["choices"]; reason?: string };
}

export function toErrorPayload(error: DataAccessError): ErrorPayload {
  return {
    error: {
      code: error.code, message: error.message, ...(error.allowed ? { allowed: error.allowed } : {}),
      ...(error.detail?.choices ? { choices: error.detail.choices } : {}), ...(error.detail?.reason ? { reason: error.detail.reason } : {}),
    },
  };
}

/** Câu tìm / truy vấn chạy quá MAX_EXECUTION_TIME (ER_QUERY_TIMEOUT, mã 3024) → `timeout`; lỗi khác ném nguyên. */
export function translateDbError(error: unknown): never {
  const { errno, code } = (error ?? {}) as { errno?: number; code?: string };
  if (errno === 3024 || code === "ER_QUERY_TIMEOUT") {
    throw new DataAccessError("timeout", "Truy vấn chạy quá lâu — thu hẹp bộ lọc (khoảng ngày, nhóm) rồi thử lại.");
  }
  throw error;
}
