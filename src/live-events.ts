import { EventEmitter } from "node:events";

// Kênh sự kiện trong tiến trình: tin vừa lưu / thu hồi → máy chủ web đẩy ngay cho trình duyệt (SSE),
// khung Hội thoại nhảy tin trong dưới một giây thay vì chờ hỏi vòng.

export interface MessageEvent {
  threadId: number;
  messageId: number;
  /**
   * "new" = vừa lưu; "recalled" = người gửi thu hồi; "thread_updated" = thông tin cuộc đổi (tên nhóm, thành viên),
   * messageId = 0 — giao diện nạp lại cột trái + thẻ cuộc, không phải dòng tin.
   */
  kind: "new" | "recalled" | "thread_updated";
}

class LiveEvents extends EventEmitter {
  emitMessage(event: MessageEvent): void {
    this.emit("message", event);
  }

  onMessage(listener: (event: MessageEvent) => void): () => void {
    this.on("message", listener);
    return () => this.off("message", listener);
  }
}

export const liveEvents = new LiveEvents();
// Nhiều tab trình duyệt cùng mở = nhiều listener; không phải rò rỉ
liveEvents.setMaxListeners(200);
