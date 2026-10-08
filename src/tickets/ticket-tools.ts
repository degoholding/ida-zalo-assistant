import type { FunctionDeclaration } from "../assistant/gemini-client.js";
import { runTicketCommand, type TicketCommand, type TicketCommandContext } from "./ticket-commands.js";

// Công cụ ticket cho trợ lý AI (08/10/2026, đại ca: «đánh dấu nó là đã xong» mà bot báo «chưa có công cụ»). Câu tự nhiên
// → mô hình gọi công cụ → chạy ĐÚNG đường của lệnh gõ (runTicketCommand), nên luật quyền y hệt: nhận / xong chỉ người xử lý
// (người báo được tự đóng ticket của mình), xem chỉ người báo / người xử lý / quản lý.

const ACTIONS = ["status", "accept", "done", "cancel", "note"] as const;
type TicketToolAction = (typeof ACTIONS)[number];

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
        action: { type: "string", enum: [...ACTIONS] },
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

function toCommand(action: TicketToolAction, ticketId: number, note: string): TicketCommand {
  switch (action) {
    case "status": return { kind: "ticket_status", ticketId };
    case "accept": return { kind: "ticket_accept", ticketId };
    case "done": return { kind: "ticket_done", ticketId, note };
    case "cancel": return { kind: "ticket_cancel", ticketId, note };
    case "note": return { kind: "ticket_note", ticketId, note };
  }
}

export async function runTicketTool(ctx: TicketCommandContext | undefined, name: string, args: Record<string, unknown>, now: Date): Promise<Record<string, unknown>> {
  if (!ctx) return { error: "Ticket chưa bật ở bot này." };
  if (name === "list_tickets") return { result: await runTicketCommand(ctx, { kind: "ticket_list" }, now) };
  if (name === "create_ticket") {
    const text = String(args.text ?? "").trim();
    if (text.length < 3) return { error: "Thiếu nội dung ticket — hỏi lại người hỏi muốn báo gì." };
    return { result: await runTicketCommand(ctx, { kind: "ticket_create", text: text.slice(0, 3000) }, now) };
  }
  const ticketId = Number(args.ticket_id);
  const action = String(args.action ?? "") as TicketToolAction;
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) return { error: "Thiếu số ticket (T-0012 → 12)." };
  if (!ACTIONS.includes(action)) return { error: "Việc không hợp lệ." };
  const note = String(args.note ?? "").trim().slice(0, 2000);
  if (action === "note" && !note) return { error: "Thiếu nội dung bổ sung." };
  return { result: await runTicketCommand(ctx, toCommand(action, ticketId, note), now) };
}
