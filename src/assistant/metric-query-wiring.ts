import { can } from "../auth/principal.js";
import { runQueryMetricsTool } from "../metrics/metric-query-tool.js";
import type { ToolContext } from "./tools.js";

// Nối công cụ `query_metrics` (phase 10) vào trợ lý — chỉ tin riêng. Phase 11 (họ `metrics`) sửa tệp này.

/** `query_metrics`: chỉ tin riêng. */
export async function runQueryMetricsInTurn(context: ToolContext, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (context.scopeGroupId !== undefined) return { error: "Số liệu chỉ hỏi được khi nhắn riêng cho bot." };
  // Quyền «Số liệu» theo vai trò tài khoản web (Quản lý / Quản trị). Người có vai trò Danh bạ chưa có tài khoản giữ như trước (principal suy ra
  // = Quản lý); người chỉ là người nhận / tài khoản đã tắt không có quyền này.
  if (!can(context.access.principal, "metric", "read")) return { error: "Anh/chị chưa được cấp quyền xem số liệu qua bot." };
  return runQueryMetricsTool({ db: context.db, now: context.now }, args);
}
