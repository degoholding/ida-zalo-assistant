import { ReplyTemplateError } from "../../reply-suggestions/reply-template-workflow.js";
import { TaskActionError } from "../../tasks/task-service.js";
import { TicketActionError } from "../../tickets/ticket-service.js";
import { ApiError } from "../../web/api/api-http.js";
import { DataAccessError, type DataAccessErrorCode } from "../data-access-errors.js";

// Các hàm dịch vụ / hàm sửa của web ném lỗi theo kiểu của chúng (ApiError, TaskActionError…). Công cụ ghi đổi hết về DataAccessError để
// cổng trả `isError` có mã — mô hình đọc được và tự sửa; lỗi hệ thống (DB sập…) ném tiếp.

const BY_STATUS: Record<number, DataAccessErrorCode> = { 403: "forbidden", 404: "not_found", 409: "invalid_state" };
const BY_TEMPLATE_CODE: Record<string, DataAccessErrorCode> = { validation: "invalid_value", forbidden: "forbidden", not_found: "not_found", conflict: "invalid_state" };

export function toDataAccessError(error: unknown): unknown {
  if (error instanceof DataAccessError) return error;
  if (error instanceof ApiError) return new DataAccessError(BY_STATUS[error.status] ?? "invalid_value", error.message);
  if (error instanceof TaskActionError || error instanceof TicketActionError) return new DataAccessError("invalid_state", error.message);
  if (error instanceof ReplyTemplateError) return new DataAccessError(BY_TEMPLATE_CODE[error.code] ?? "invalid_value", error.message);
  return error;
}

/** Chạy `run`, đổi lỗi nghiệp vụ sang DataAccessError. */
export async function guardWrite<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toDataAccessError(error);
  }
}
