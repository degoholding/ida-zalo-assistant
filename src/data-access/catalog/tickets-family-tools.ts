import { TICKET_FAMILY_TOOLS } from "../tickets/ticket-command-tools.js";
import { TICKET_TOOLS_PROMPT } from "../../tickets/ticket-tools.js";
import type { FamilyCatalog } from "./family-catalog.js";

// Họ «tickets» (phase 8): công cụ mô hình `list_tickets` / `ticket_action` / `create_ticket` (tên + khai báo giữ nguyên) và công cụ lệnh gõ
// `ticket_list_for_actor` / `ticket_get` / `ticket_create` / `ticket_act`. Ghi theo QUAN HỆ của liên hệ Zalo và GHI NGAY (BC1 bỏ) — nên không có
// thao tác nháp (`actions` rỗng, không cần `confirm_draft`). Lời nhắc = lời nhắc cũ (bộ chuyển gỡ bản trong system prompt rồi nối bản này).
export const ticketsFamilyCatalog: FamilyCatalog = {
  family: "tickets",
  tools: TICKET_FAMILY_TOOLS,
  actions: [],
  instructions: TICKET_TOOLS_PROMPT.trim(),
};
