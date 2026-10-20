import { REMINDER_TOOL_PROMPT, SEND_TOOL_PROMPT } from "../../send-commands/send-tool-prompts.js";
import { BRIEF_CHECK_TOOLS } from "../send/brief-request-check-tool.js";
import { SEND_CONTEXT_TOOLS } from "../send/send-context-tool.js";
import { SEND_DRAFT_TOOLS } from "../send/send-draft-tools.js";
import { SEND_LIFECYCLE_TOOLS } from "../send/send-draft-lifecycle-tools.js";
import type { FamilyCatalog } from "./family-catalog.js";

// Họ «send» (phase 12): lệnh gửi tin (nháp G-… ở kho riêng `send_command`, KHÔNG gộp vào `mcp_write_draft`) + tra bản tin gọi tay.
// - Mặt mô hình (tên + khai báo giữ nguyên): `propose_send_message`, `propose_group_reminder` — tạo nháp, bản xem trước đi qua `effects.fixedReply`; mô hình KHÔNG có công cụ xác nhận.
// - Mặt lệnh gõ / phía trợ lý: `send_context`, `send_draft_create`, `send_pin_draft_create`, `send_draft_confirm`, `send_draft_cancel`, `send_draft_list`, `send_draft_pending`,
//   `brief_request_check`. Không công cụ nào có mặt `mcp_http` (quyết định 9: gửi Zalo qua MCP ngoài ngoài phạm vi).
// - Ngoài MCP (O6): gửi Zalo thật (việc nền), Google Calendar / Meet (`propose_group_pin`, `propose_meeting_announcement` chọn cuộc họp ở phía trợ lý rồi ghi nháp qua
//   `send_pin_draft_create` / `send_draft_create`), điểm tin AI + PDF / Excel của bản tin (`send_brief`).
// `actions` rỗng: nháp gửi có kho + `confirm` riêng (`send_draft_confirm`), không đi qua `confirm_draft` của kho `mcp_write_draft`.
// Lời nhắc: CHỈ hai công cụ lên máy chủ (gửi tin, nhắc hẹn). Lời nhắc ghim / lời mời họp / `send_brief` (công cụ còn chạy phía trợ lý) do system prompt thêm
// theo điều kiện từng công cụ — `legacy-family-prompts.ts` (send) gỡ đúng hai lời nhắc này nên không mất, không trùng.
export const sendFamilyCatalog: FamilyCatalog = {
  family: "send",
  tools: [...SEND_DRAFT_TOOLS, ...SEND_CONTEXT_TOOLS, ...SEND_LIFECYCLE_TOOLS, ...BRIEF_CHECK_TOOLS],
  actions: [],
  instructions: [SEND_TOOL_PROMPT, REMINDER_TOOL_PROMPT].map((prompt) => prompt.trim()).join("\n\n"),
};
