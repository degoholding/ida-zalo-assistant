import { ACK_TEXTS } from "../assistant/assistant-ack-texts.js";

// Câu «em nhận được rồi, chờ em chút» — báo người hỏi biết phải chờ khi câu trả lời chưa về. Dùng chung cho tin
// riêng và tin nhóm. Trả lời xong trong ACK_DELAY_MS thì không nhắn (hỏi dễ mà hai tin liền nhau thì rườm).
// Danh sách câu nằm ở src/assistant/assistant-ack-texts.ts (trợ lý cũng cần nhận ra câu chờ).

/** Đổi 2,5 giây → 1 giây (06/10/2026): người hỏi muốn thấy bot đã nhận việc gần như ngay. */
export const ACK_DELAY_MS = 1000;

/** Đổi câu cho đỡ máy móc. */
export function pickAckText(random: () => number = Math.random): string {
  return ACK_TEXTS[Math.floor(random() * ACK_TEXTS.length) % ACK_TEXTS.length];
}
