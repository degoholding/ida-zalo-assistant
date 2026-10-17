import { McpCallStatus } from "../constants.js";
import type { ToolResult } from "../data-access/tool-runner.js";

// Đổi kết quả của lõi truy cập dữ liệu (ToolResult) sang kết quả công cụ MCP + mã trạng thái cho mcp_call_log.

export interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Thành công: chữ + structuredContent (client SDK kiểm theo outputSchema). Lỗi: chỉ chữ, không structuredContent (không khớp outputSchema). */
export function toCallToolResult(result: ToolResult): McpToolResult {
  if (result.isError) return { content: [{ type: "text", text: result.text }], isError: true };
  const structured = result.structured;
  return {
    content: [{ type: "text", text: result.text }],
    ...(structured && typeof structured === "object" && !Array.isArray(structured) ? { structuredContent: structured as Record<string, unknown> } : {}),
  };
}

/** Lỗi nghiệp vụ → Denied (không đủ quyền / ngoài phạm vi) hoặc Invalid (tham số sai); timeout tính Error. */
export function statusOf(result: ToolResult): McpCallStatus {
  if (!result.isError) return McpCallStatus.Ok;
  if (result.errorCode === "forbidden" || result.errorCode === "not_found") return McpCallStatus.Denied;
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
export function serverBusyResult(): McpToolResult {
  const message = "Máy chủ đang bận xử lý nhiều truy vấn — đợi vài giây rồi thử lại, và thu hẹp bộ lọc (khoảng ngày, nhóm) nếu có thể.";
  const payload = { error: { code: "server_busy", message, retry_after_seconds: 5 } };
  return { content: [{ type: "text", text: `Lỗi server_busy: ${message}\n${JSON.stringify(payload)}` }], isError: true };
}

export const INTERNAL_ERROR_RESULT: McpToolResult = {
  content: [{ type: "text", text: "Lỗi máy chủ — đã ghi nhật ký, thử lại sau." }],
  isError: true,
};
