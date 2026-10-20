import type { AssistantFamily } from "../../data-access/tool-definition.js";
import { QUERY_METRICS_PROMPT } from "../../metrics/metric-query-tool.js";
import { SUGGEST_REPLIES_PROMPT } from "../../reply-suggestions/reply-suggestion-tool.js";
import { SEND_TOOL_PROMPT } from "../../send-commands/send-command-tool.js";
import { REMINDER_TOOL_PROMPT } from "../../send-commands/send-reminder-tool.js";
import { TASK_TOOLS_PROMPT } from "../../tasks/task-tools.js";
import { TICKET_TOOLS_PROMPT } from "../../tickets/ticket-tools.js";
import { ALERT_TOOLS_PROMPT } from "../alert-tools.js";
import { CORE_QUERY_TOOLS_PROMPT, WRITE_TOOLS_PROMPT } from "../core-tools-prompt.js";

// Lời nhắc CŨ (hằng trong system prompt) của từng họ. Họ đã chuyển sang MCP thì lời nhắc này bị gỡ và thay bằng `instructions` của
// máy chủ MCP (T3). Chỉ gỡ khi họ thật sự có công cụ trên danh sách của lượt — xem `turn-tool-declarations.ts`.

export const LEGACY_FAMILY_PROMPTS: Readonly<Record<AssistantFamily, readonly string[]>> = {
  core: [CORE_QUERY_TOOLS_PROMPT],
  drafts: [WRITE_TOOLS_PROMPT],
  reads: [],
  files: [SUGGEST_REPLIES_PROMPT],
  tickets: [TICKET_TOOLS_PROMPT],
  tasks: [TASK_TOOLS_PROMPT],
  alerts: [ALERT_TOOLS_PROMPT],
  metrics: [QUERY_METRICS_PROMPT],
  // Ghim / lời mời họp / send_brief còn chạy phía trợ lý: lời nhắc của chúng ở lại system prompt (thêm theo điều kiện từng công cụ)
  send: [SEND_TOOL_PROMPT, REMINDER_TOOL_PROMPT],
};
