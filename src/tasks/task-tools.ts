import type { FunctionDeclaration } from "../assistant/gemini-client.js";
import type { TaskCommandContext } from "./task-commands-legacy.js";
import { DUE_HELP, runTaskToolLegacy, TASK_LIST_SCOPES, TASK_TOOL_ACTIONS } from "./task-tools-legacy.js";

// Công cụ việc (checklist, phase 7) cho trợ lý AI: câu tự nhiên («Minh làm xong báo giá rồi nhé», «dời việc đó sang thứ 2»)
// → mô hình gọi công cụ → chạy ĐÚNG luật của lệnh gõ, nên quyền y hệt. Riêng save_recap_tasks lưu cả bảng phân công của một bản recap họp khi
// người hỏi đồng ý. Tệp này giữ KHAI BÁO + lời nhắc (cả hai đường dùng chung: họ `tasks` bật thì lõi MCP khai lại đúng chữ này —
// `data-access/catalog/tasks-family-tools.ts`); executor cũ ở task-tools-legacy.ts.

export const TASK_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "list_tasks",
    description: "Danh sách việc trong checklist. scope: mine = việc người hỏi phụ trách / đã giao; group = mọi việc đang làm (hỏi trong " +
      "nhóm = việc của nhóm đó); overdue = việc quá hạn; proposed = đề xuất chờ xác nhận.",
    parameters: { type: "object", properties: { scope: { type: "string", enum: TASK_LIST_SCOPES } } },
  },
  {
    name: "create_task",
    description: "Giao MỘT việc mới khi người hỏi GIAO VIỆC rõ ràng («giao Minh gửi báo giá trước thứ 6», «nhờ Lan chốt công nợ mai»). " +
      "Không tạo từ câu kể chuyện / hỏi han. assignee = tên người làm như người hỏi gọi. " + DUE_HELP + " Công cụ tự tìm người, tự báo người đó.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Việc cần làm, ngắn gọn, bắt đầu bằng động từ" },
        assignee: { type: "string" },
        due: { type: "string" },
        priority: { type: "string", enum: ["Cao", "TB", "Thấp"] },
      },
      required: ["title", "assignee"],
    },
  },
  {
    name: "task_action",
    description: "Làm một việc với MỘT việc trong checklist: status = xem; done = đã xong (note = ghi chú); reschedule = dời hạn (due); " +
      "reassign = giao lại (assignee = tên); cancel = hủy (note = lý do); reopen = mở lại; confirm / reject = lưu / bỏ một đề xuất; " +
      "note = ghi chú, nhắn các bên. task_id là số trong mã (V-12 → 12). «Việc đó / nó» = việc vừa nhắc; không rõ việc nào thì " +
      "list_tasks rồi hỏi lại. " + DUE_HELP,
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "integer" },
        action: { type: "string", enum: [...TASK_TOOL_ACTIONS] },
        due: { type: "string" },
        assignee: { type: "string" },
        note: { type: "string" },
      },
      required: ["task_id", "action"],
    },
  },
  {
    name: "save_recap_tasks",
    description: "Người hỏi đồng ý lưu các việc của một bản recap họp vào checklist: truyền ĐÚNG danh sách «Phân công» của bản recap " +
      "(người, việc, hạn như đã ghi). Người không tìm thấy / hạn không rõ vẫn lưu, công cụ báo lại để bổ sung.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: { task: { type: "string" }, owner: { type: "string" }, due: { type: "string" }, priority: { type: "string" } },
            required: ["task"],
          },
        },
      },
      required: ["tasks"],
    },
  },
];

export const TASK_TOOL_NAMES = new Set(TASK_TOOL_DECLARATIONS.map((tool) => tool.name));

export const TASK_TOOLS_PROMPT = `

VIỆC (checklist, bot nhắc theo hạn): người hỏi giao việc / hỏi việc / báo xong / dời hạn / giao lại → gọi create_task / list_tasks /
task_action NGAY lượt này rồi báo đúng kết quả công cụ, 1–2 câu. Chỉ create_task khi có lời GIAO VIỆC rõ ràng; thiếu người làm thì
hỏi lại. Không bảo người hỏi tự gõ lệnh khi công cụ làm được.`;

/**
 * Executor của đường CŨ (họ `tasks` tắt, hoặc phiên MCP không mở được). Họ bật thì bộ định tuyến của lượt gọi thẳng công cụ MCP cùng
 * tên (`tool-registry.resolveExecutor`) và hàm này không chạy.
 */
export function runTaskTool(ctx: TaskCommandContext | undefined, name: string, args: Record<string, unknown>, now: Date): Promise<Record<string, unknown>> {
  return runTaskToolLegacy(ctx, name, args, now);
}
