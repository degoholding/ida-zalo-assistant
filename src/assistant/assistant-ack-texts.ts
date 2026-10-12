// Câu «em nhận được rồi, chờ em chút» bot nhắn khi câu trả lời chưa về (src/zalo/assistant-ack.ts gửi). Để ở đây vì trợ lý cũng
// cần nhận ra chúng: bỏ khỏi lịch sử đưa mô hình và chặn khi mô hình trả đúng một câu chờ (sự cố prod 12/10/2026, lượt «okee»
// #128 — lịch sử đầy câu chờ của bot, mô hình bắt chước trả câu chờ rồi không làm gì).

export const ACK_TEXTS = [
  "Dạ em nhận được rồi, chờ em một xíu nhé…",
  "Dạ, em đang xem, anh/chị chờ em chút nhé…",
  "Em nhận được rồi ạ, đang làm, có ngay thôi…",
];

const normalizeAck = (text: string): string => text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
const ACK_SET = new Set(ACK_TEXTS.map(normalizeAck));

/** Chữ này có phải đúng một câu «chờ em xíu» không (bỏ qua hoa thường / khoảng trắng). */
export function isAckText(text: string): boolean {
  return ACK_SET.has(normalizeAck(text));
}

/** Thay cho câu chờ mô hình lỡ trả làm câu trả lời — hỏi lại, nhắc cách xác nhận lệnh đang chờ. */
export const UNCLEAR_REPLY = "Em chưa rõ anh/chị muốn em làm gì tiếp — anh/chị nói rõ giúp em nhé. Nếu đang có bản xem trước lệnh gửi / nhắc hẹn thì nhắn «đồng ý» để làm, «hủy» để bỏ.";
