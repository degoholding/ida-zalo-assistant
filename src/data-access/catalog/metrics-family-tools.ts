import { queryMetricsTool } from "../metrics/query-metrics-tool.js";
import type { FamilyCatalog } from "./family-catalog.js";
import { QUERY_METRICS_PROMPT } from "./metrics-family-instructions.js";

// Họ «metrics»: `query_metrics` (hỏi số liệu theo tên chỉ tiêu + kỳ chữ) cho mô hình trợ lý. Cổng /mcp ngoài dùng `metrics_summary` (mở rộng
// thêm `metric_name` / `period`, xem operations/metrics-summary-operation.ts).
export const metricsFamilyCatalog: FamilyCatalog = { family: "metrics", tools: [queryMetricsTool], actions: [], instructions: QUERY_METRICS_PROMPT };
