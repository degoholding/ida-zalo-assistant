import { TASK_COMMAND_TOOLS } from "../tasks/task-command-tools.js";
import { TASK_MODEL_TOOLS } from "../tasks/task-model-tools.js";
import { TASK_TOOLS_PROMPT } from "../../tasks/task-tools.js";
import type { FamilyCatalog } from "./family-catalog.js";

// Họ «tasks» (phase 9): công cụ mô hình `list_tasks` / `create_task` / `task_action` / `save_recap_tasks` (tên + khai báo giữ nguyên) và công cụ lệnh gõ
// `task_list_for_actor` / `task_get` / `task_create` / `task_act` / `task_confirm_latest_recap`. Ghi theo QUAN HỆ của liên hệ Zalo và GHI NGAY (BC1 bỏ) — nên
// không có thao tác nháp (`actions` rỗng, không cần `confirm_draft`). Việc AI tự bắt từ nhóm vẫn chờ «ok V-12» (ngoài MCP). Lời nhắc = lời nhắc cũ
// (bộ chuyển gỡ bản trong system prompt rồi nối bản này).
export const tasksFamilyCatalog: FamilyCatalog = {
  family: "tasks",
  tools: [...TASK_MODEL_TOOLS, ...TASK_COMMAND_TOOLS],
  actions: [],
  instructions: TASK_TOOLS_PROMPT.trim(),
};
