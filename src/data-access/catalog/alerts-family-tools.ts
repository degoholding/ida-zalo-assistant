import { ALERT_FAMILY_INSTRUCTIONS } from "../../assistant/alert-tools.js";
import { ALERT_CONFIG_DRAFT_TOOLS } from "../alerts/alert-config-draft-tools.js";
import { ALERT_CONFIG_VIEW_TOOLS } from "../alerts/alert-config-view-tool.js";
import { ALERT_ITEM_HANDLED_TOOLS } from "../alerts/alert-item-handled-tools.js";
import { PENDING_ITEMS_TOOLS } from "../alerts/pending-items-operation.js";
import type { FamilyCatalog } from "./family-catalog.js";

// Họ «alerts» (phase 10): tin cần xử lý, đánh dấu xong, cấu hình cảnh báo + VIP — chỉ mặt trợ lý (mô hình / lệnh gõ), KHÔNG có mặt `mcp_http` nên cổng
// /mcp ngoài không thấy công cụ cấu hình nào (README «Quy tắc quyền»: không ghi cài đặt qua AI — ngoại lệ ĐANG CÓ của Zalo nay đi qua lõi, không mở rộng).
// Mô hình: `list_pending_items` (đọc), `mark_item_handled` (ghi ngay), `propose_alert_change` (nháp); `confirm_alert_change` bị gỡ — chỉ tin «đồng ý» của người
// dùng xác nhận (BC3). `actions` rỗng: thao tác ghi của họ (`alert_*`) không có công cụ `propose_*` ở cổng ngoài và nháp `alert_config_change` được
// xác nhận bằng công cụ lệnh `alert_config_confirm` của chính họ (tra thao tác trong bảng riêng) — tài khoản không có quyền ghi web cũng xác nhận được.
export const alertsFamilyCatalog: FamilyCatalog = {
  family: "alerts",
  tools: [...PENDING_ITEMS_TOOLS, ...ALERT_ITEM_HANDLED_TOOLS, ...ALERT_CONFIG_VIEW_TOOLS, ...ALERT_CONFIG_DRAFT_TOOLS],
  actions: [],
  instructions: ALERT_FAMILY_INSTRUCTIONS,
};
