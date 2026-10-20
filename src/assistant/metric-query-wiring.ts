import { can } from "../auth/principal.js";
import { runQueryMetricsTool } from "../metrics/metric-query-tool.js";
import type { ToolContext } from "./tools.js";

// Đường CŨ của `query_metrics` (họ `metrics` tắt) — chỉ tin riêng. Họ bật thì `resolveExecutor` đã chuyển lời gọi sang MCP trước khi tới đây
// (công cụ `query_metrics` ở data-access/metrics/query-metrics-tool.ts, cùng hàm lõi). Gỡ ở phase 13.

/** `query_metrics`: chỉ tin riêng. */
export async function runQueryMetricsInTurn(context: ToolContext, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (context.scopeGroupId !== undefined) return { error: "Số liệu chỉ hỏi được khi nhắn riêng cho bot." };
  // Quyền «Số liệu» theo vai trò tài khoản web (Quản lý / Quản trị). Người có vai trò Danh bạ chưa có tài khoản giữ như trước (principal suy ra
  // = Quản lý); người chỉ là người nhận / tài khoản đã tắt không có quyền này.
  if (!can(context.access.principal, "metric", "read")) return { error: "Anh/chị chưa được cấp quyền xem số liệu qua bot." };
  return runQueryMetricsTool({ db: context.db, now: context.now }, args);
}
