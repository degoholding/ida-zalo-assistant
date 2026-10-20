import { z } from "zod/v4";
import { canUse } from "../data-access-context.js";
import { eraseTool, type AnyToolDefinition, type ToolDefinition } from "../tool-definition.js";
import { METRIC_PERIODS } from "../resolvers/metric-period-resolver.js";
import { runQueryMetrics } from "./metric-query-core.js";

// `query_metrics` cho MÔ HÌNH trợ lý (mặt `assistant_model`, họ `metrics`): tên + tham số + câu trả lời giữ y công cụ cũ (T3). Chỉ tin riêng
// (hỏi trong nhóm → không có công cụ), cần quyền `metric.read`. Kết quả (kể cả `{ error, available_metrics }`) trả nguyên như cũ.

const inputSchema = z.object({
  metric: z.string().describe("Tên chỉ tiêu, vd «doanh số», «tồn kho» (bỏ trống để xem danh sách chỉ tiêu đang có)"),
  period: z.enum(METRIC_PERIODS).optional().describe("Kỳ: today, yesterday, this_week (T2 → hôm nay), last_week, this_month (ngày 1 → hôm nay), last_month, custom (kèm from / to)"),
  from: z.string().optional().describe("Ngày bắt đầu «YYYY-MM-DD» (khi period = custom)"),
  to: z.string().optional().describe("Ngày kết thúc «YYYY-MM-DD» (khi period = custom)"),
  area: z.string().optional().describe("Khu vực, vd «Miền Tây» (tùy chọn)"),
  staff: z.string().optional().describe("Tên nhân viên (tùy chọn)"),
  group_by: z.enum(["none", "staff", "area", "date"]).optional().describe("Chia dòng theo nhân viên / khu vực / ngày (mặc định none = chỉ tổng)"),
});
type QueryMetricsInput = z.infer<typeof inputSchema>;

const outputSchema = z.record(z.string(), z.unknown());

const NO_PERMISSION = "Anh/chị chưa được cấp quyền xem số liệu qua bot.";
const GROUP_REFUSAL = "Số liệu chỉ hỏi được khi nhắn riêng cho bot.";

const tool: ToolDefinition<QueryMetricsInput, Record<string, unknown>> = {
  name: "query_metrics",
  title: "Hỏi số liệu theo tên chỉ tiêu",
  description:
    "SỐ LIỆU kinh doanh đọc từ bảng Google Sheets của công ty (doanh số, tồn kho… theo ngày / tuần / tháng, khu vực, nhân viên). " +
    "Trả tổng kỳ này, kỳ trước, % đổi, các dòng nhóm, số dòng có cờ, nguồn + giờ đọc. KHÔNG lấy số từ tin nhắn chat. Mỗi lần hỏi MỘT chỉ tiêu.",
  input: () => inputSchema,
  output: outputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  surfaces: ["assistant_model"],
  family: "metrics",
  assistantErrorShape: "string",
  available: (ctx) => ctx.groupScopeId === undefined && canUse(ctx, "metric", "read"),
  async handler(ctx, input) {
    // Phòng thủ: `available` đã chặn, nhưng giữ đúng câu chữ cũ nếu lời gọi vẫn tới đây
    if (ctx.groupScopeId !== undefined) return { structured: { error: GROUP_REFUSAL }, summary: GROUP_REFUSAL, rowCount: 0 };
    if (!canUse(ctx, "metric", "read")) return { structured: { error: NO_PERMISSION }, summary: NO_PERMISSION, rowCount: 0 };
    const structured = await runQueryMetrics({ db: ctx.db, now: ctx.now }, input);
    const rows = Array.isArray(structured.rows) ? structured.rows.length : 0;
    return { structured, summary: typeof structured.error === "string" ? structured.error : `Số liệu ${String(structured.period ?? "")}: ${rows} dòng.`, rowCount: rows, entity: "metrics" };
  },
};

export const queryMetricsTool: AnyToolDefinition = eraseTool(tool);
