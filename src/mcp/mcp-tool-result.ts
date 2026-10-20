import { McpCallStatus } from "../constants.js";
import type { ToolResult } from "../data-access/tool-runner.js";
import { ERROR_META_KEY, TURN_META_KEY } from "./mcp-meta-keys.js";

// Đổi kết quả của lõi truy cập dữ liệu (ToolResult) sang kết quả công cụ MCP + mã trạng thái cho mcp_call_log.

export interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  /** Chỉ ở mặt trợ lý (`rich`): mã lỗi có cấu trúc + tác động của lượt. Cổng ngoài không bao giờ có `_meta`. */
  _meta?: Record<string, unknown>;
}

/** Gắn payload lỗi có cấu trúc `{ code, message, allowed? }` vào `_meta` (bộ chuyển của trợ lý đọc, mô hình không thấy). */
export function withErrorMeta(result: McpToolResult, payload: { code: string; message: string; allowed?: string[] }): McpToolResult {
  return { ...result, _meta: { ...result._meta, [ERROR_META_KEY]: payload } };
}

/**
 * Thành công: chữ + structuredContent (client SDK kiểm theo outputSchema). Lỗi: chỉ chữ, không structuredContent (không khớp outputSchema).
 * `rich` (mặt trợ lý): thêm `_meta` — lỗi có `ERROR_META_KEY`, thành công có `TURN_META_KEY` nếu công cụ khai tác động. Mặt `mcp_http`
 * luôn `rich = false` nên không bao giờ lộ tác động của lượt.
 */
export function toCallToolResult(result: ToolResult, rich = false): McpToolResult {
  if (result.isError) {
    const failure: McpToolResult = { content: [{ type: "text", text: result.text }], isError: true };
    const error = (result.structured as { error?: { code: string; message: string; allowed?: string[] } } | undefined)?.error;
    return rich && error ? withErrorMeta(failure, error) : failure;
  }
  const structured = result.structured;
  return {
    content: [{ type: "text", text: result.text }],
    ...(structured && typeof structured === "object" && !Array.isArray(structured) ? { structuredContent: structured as Record<string, unknown> } : {}),
    ...(rich && result.effects ? { _meta: { [TURN_META_KEY]: result.effects } } : {}),
  };
}

/** Lỗi nghiệp vụ → Denied (không đủ quyền / ngoài phạm vi) hoặc Invalid (tham số sai); timeout tính Error. */
export function statusOf(result: ToolResult): McpCallStatus {
  if (!result.isError) return McpCallStatus.Ok;
  if (result.errorCode === "forbidden" || result.errorCode === "not_found" || result.errorCode === "confidential" || result.errorCode === "not_allowed") return McpCallStatus.Denied;
  if (result.errorCode === "timeout") return McpCallStatus.Error;
  if (result.errorCode === "rate_limited") return McpCallStatus.RateLimited;
  return McpCallStatus.Invalid;
}

/** Kết quả khi vượt nhịp: mô hình đọc mã `rate_limited` + số giây chờ rồi tự giãn lời gọi. */
export function rateLimitedResult(retryAfterSeconds: number, reason: "rate" | "concurrent"): McpToolResult {
  const message = reason === "rate"
    ? `Gọi quá nhanh — đợi khoảng ${retryAfterSeconds} giây rồi thử lại.`
    : "Đang có quá nhiều lời gọi chạy cùng lúc với khóa này — đợi một lát rồi thử lại.";
  const payload = { error: { code: "rate_limited", message, retry_after_seconds: retryAfterSeconds } };
  return { content: [{ type: "text", text: `Lỗi rate_limited: ${message}\n${JSON.stringify(payload)}` }], isError: true };
}

/** Cổng đồng thời toàn cục đầy quá hạn chờ: hệ thống đang bận chung, khác `rate_limited` (lỗi của riêng khóa). */
export function serverBusyResult(rich = false): McpToolResult {
  const message = "Máy chủ đang bận xử lý nhiều truy vấn — đợi vài giây rồi thử lại, và thu hẹp bộ lọc (khoảng ngày, nhóm) nếu có thể.";
  const payload = { error: { code: "server_busy", message, retry_after_seconds: 5 } };
  const result: McpToolResult = { content: [{ type: "text", text: `Lỗi server_busy: ${message}\n${JSON.stringify(payload)}` }], isError: true };
  return rich ? withErrorMeta(result, payload.error) : result;
}

const INTERNAL_ERROR_TEXT = "Lỗi máy chủ — đã ghi nhật ký, thử lại sau.";

export const INTERNAL_ERROR_RESULT: McpToolResult = { content: [{ type: "text", text: INTERNAL_ERROR_TEXT }], isError: true };

/** Lỗi hệ thống: cổng ngoài trả chữ chung; mặt trợ lý thêm mã `internal` để bộ chuyển dựng lỗi cho mô hình. */
export function internalErrorResult(rich: boolean): McpToolResult {
  return rich ? withErrorMeta(INTERNAL_ERROR_RESULT, { code: "internal", message: INTERNAL_ERROR_TEXT }) : INTERNAL_ERROR_RESULT;
}
