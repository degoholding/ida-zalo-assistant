import type { FunctionDeclaration } from "../assistant/gemini-client.js";
import type { TicketCommandContext } from "./ticket-commands-legacy.js";
import { runTicketToolLegacy, TICKET_TOOL_ACTIONS } from "./ticket-tools-legacy.js";

// Công cụ ticket cho trợ lý AI (08/10/2026, đại ca: «đánh dấu nó là đã xong» mà bot báo «chưa có công cụ»). Câu tự nhiên
// → mô hình gọi công cụ → chạy ĐÚNG luật của lệnh gõ, nên quyền y hệt: nhận / xong chỉ người xử lý (người báo được tự đóng ticket
// của mình), xem chỉ người báo / người xử lý / quản lý. Tệp này giữ KHAI BÁO + lời nhắc (cả hai đường dùng chung: họ `tickets` bật
// thì lõi MCP khai lại đúng chữ này — `data-access/catalog/tickets-family-tools.ts`); executor cũ ở ticket-tools-legacy.ts.

export const TICKET_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "list_tickets",
    description: "Danh sách ticket: người xử lý / quản lý thấy các ticket đang mở, người khác thấy ticket mình đã báo. " +
      "Dùng cho «có bao nhiêu ticket», «ticket nào đang chờ», «ticket của tôi».",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "ticket_action",
    description: "Làm một việc với MỘT ticket theo lời người đang hỏi: status = xem tình hình; accept = nhận xử lý; done = đánh dấu " +
      "đã xong (note = ghi chú xử lý); cancel = hủy (note = lý do); note = bổ sung nội dung / nhắn người kia. ticket_id là số trong " +
      "mã (T-0012 → 12). «Nó / ticket đó / cái vừa rồi» = ticket vừa nhắc trong hội thoại; không rõ ticket nào thì hỏi lại. " +
      "Công cụ tự kiểm quyền và tự báo qua Zalo cho người liên quan.",
    parameters: {
      type: "object",
      properties: {
        ticket_id: { type: "integer" },
        action: { type: "string", enum: [...TICKET_TOOL_ACTIONS] },
        note: { type: "string", description: "Ghi chú / lý do / nội dung bổ sung (tùy việc)" },
      },
      required: ["ticket_id", "action"],
    },
  },
  {
    name: "create_ticket",
    description: "Tạo ticket MỚI khi người hỏi nhờ báo lỗi / sự cố / việc cần hỗ trợ. text = mô tả đầy đủ bằng lời của người hỏi " +
      "(dòng đầu là tiêu đề ngắn). Ảnh người hỏi vừa gửi trong 15 phút tự gắn vào ticket.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
];

export const TICKET_TOOL_NAMES = new Set(TICKET_TOOL_DECLARATIONS.map((tool) => tool.name));

export const TICKET_TOOLS_PROMPT = `

TICKET: người hỏi muốn xem / nhận / đánh dấu xong / hủy / bổ sung một ticket, hoặc báo lỗi mới → gọi list_tickets / ticket_action /
create_ticket NGAY lượt này rồi báo lại đúng kết quả công cụ, 1–2 câu. Không bảo người hỏi tự gõ lệnh khi công cụ làm được.`;

/**
 * Executor của đường CŨ (họ `tickets` tắt, hoặc phiên MCP không mở được). Họ bật thì bộ định tuyến của lượt gọi thẳng công cụ MCP cùng
 * tên (`tool-registry.resolveExecutor`) và hàm này không chạy.
 */
export function runTicketTool(ctx: TicketCommandContext | undefined, name: string, args: Record<string, unknown>, now: Date): Promise<Record<string, unknown>> {
  return runTicketToolLegacy(ctx, name, args, now);
}
