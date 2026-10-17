import { METRIC_VALUE_LIST_SPEC } from "../../web/api/metrics-api.js";
import type { EntityDefinition } from "../entity-definition.js";

// Số liệu kinh doanh đọc từ bảng tính (chỉ nguồn đang bật). Quyền metric.read: Quản trị + Quản lý. Tổng hợp có % đổi kỳ trước:
// dùng metrics_summary.
export const metricValueEntity: EntityDefinition = {
  name: "metrics",
  title: "Số liệu",
  permission: "metric",
  from: "metric_value v JOIN metric_source s ON s.id = v.source_id",
  spec: () => METRIC_VALUE_LIST_SPEC,
  // Hàm lọc cờ (bit) của web chỉ hiểu các phép này
  filterOps: { flags: ["eq", "ne", "in", "not_in"] },
  columns: {
    id: { sql: "v.id", type: "number" },
    metric_date: { sql: "DATE_FORMAT(v.metric_date, '%Y-%m-%d')", type: "day" },
    metric_code: { sql: "v.metric_code", type: "text" },
    value: { sql: "v.value", type: "number" },
    staff_name: { sql: "v.staff_name", type: "text" },
    catalog_entry_id: { sql: "v.catalog_entry_id", type: "number" },
    area_key: { sql: "v.area_key", type: "text" },
    area_name: { sql: "v.area_name", type: "text" },
    source_id: { sql: "v.source_id", type: "number" },
    source_name: { sql: "s.name", type: "text" },
    raw_text: { sql: "v.raw_text", type: "text", untrusted: true },
    flags: { sql: "v.flags", type: "number" },
  },
  defaultFields: ["id", "metric_date", "metric_code", "value", "staff_name", "area_name", "flags"],
  baseWhere: (ctx) => ({ sql: "s.tenant_id = ? AND s.is_active = 1", params: [ctx.principal.tenantId] }),
  aggregate: { groupBy: ["metric_code", "metric_date", "area_key", "area_name", "staff_name", "catalog_entry_id", "source_id"], sum: ["value"] },
  notes: ["flags là bit cộng được: 1 số âm, 2 lệch > 30%, 4 ô không đọc được, 8 nhân viên lạ (0 = sạch)."],
};
