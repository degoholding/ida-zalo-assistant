// mcp-guard: legacy(metrics) — đường cũ của trợ lý (họ metrics tắt) ủy quyền cho lõi; gỡ ở phase 13
import { runQueryMetrics } from "../data-access/metrics/metric-query-core.js";
import { METRIC_PERIODS } from "../data-access/resolvers/metric-period-resolver.js";
import type { FunctionDeclaration } from "../assistant/gemini-client.js";
import type { Db } from "../db/pool.js";

export { QUERY_METRICS_PROMPT } from "../data-access/catalog/metrics-family-instructions.js";
export { resolveQueryPeriod, type QueryPeriod } from "../data-access/resolvers/metric-period-resolver.js";

// Công cụ AI `query_metrics` (phase 10 — N3, phase 3 nối): trả SỐ đã đọc từ bảng Drive (bảng metric_value) kèm kỳ trước, % đổi,
// cờ và nguồn + giờ đọc. Chỉ tin riêng (không có trong nhóm). Không có dữ liệu thì nói rõ — không bịa số.

const PERIODS = METRIC_PERIODS;

export const QUERY_METRICS_DECLARATION: FunctionDeclaration = {
  name: "query_metrics",
  description:
    "SỐ LIỆU kinh doanh đọc từ bảng Google Sheets của công ty (doanh số, tồn kho… theo ngày / tuần / tháng, khu vực, nhân viên). " +
    "Trả tổng kỳ này, kỳ trước, % đổi, các dòng nhóm, số dòng có cờ, nguồn + giờ đọc. KHÔNG lấy số từ tin nhắn chat. Mỗi lần hỏi MỘT chỉ tiêu.",
  parameters: {
    type: "object",
    properties: {
      metric: { type: "string", description: "Tên chỉ tiêu, vd «doanh số», «tồn kho» (bỏ trống để xem danh sách chỉ tiêu đang có)" },
      period: { type: "string", enum: [...PERIODS], description: "Kỳ: today, yesterday, this_week (T2 → hôm nay), last_week, this_month (ngày 1 → hôm nay), last_month, custom (kèm from / to)" },
      from: { type: "string", description: "Ngày bắt đầu «YYYY-MM-DD» (khi period = custom)" },
      to: { type: "string", description: "Ngày kết thúc «YYYY-MM-DD» (khi period = custom)" },
      area: { type: "string", description: "Khu vực, vd «Miền Tây» (tùy chọn)" },
      staff: { type: "string", description: "Tên nhân viên (tùy chọn)" },
      group_by: { type: "string", enum: ["none", "staff", "area", "date"], description: "Chia dòng theo nhân viên / khu vực / ngày (mặc định none = chỉ tổng)" },
    },
    required: ["metric"],
  },
};


/** Đường cũ của trợ lý: cùng hàm lõi với công cụ MCP `query_metrics` (quyền + tin riêng kiểm ở `metric-query-wiring`). */
export function runQueryMetricsTool(context: { db: Db; now: Date }, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return runQueryMetrics(context, args);
}
