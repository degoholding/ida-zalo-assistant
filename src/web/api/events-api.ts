import { liveEvents } from "../../live-events.js";
import type { ApiRoute } from "./api-route.js";

// Kênh đẩy (Server-Sent Events) cho giao diện: tin vừa lưu / thu hồi → trình duyệt nạp lại đúng cuộc
// đó ngay. Một kết nối GET giữ mở; nhịp tim 25 giây để proxy / Cloudflare không cắt.

const HEARTBEAT_MS = 25_000;

export const eventRoutes: ApiRoute[] = [
  ["GET", /^\/api\/events$/, async ({ request, response, principal }) => {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      // nginx / Cloudflare: đừng gom bộ đệm, phải đẩy từng dòng
      "X-Accel-Buffering": "no",
    });
    response.write("retry: 3000\n\n");
    const unsubscribe = liveEvents.onMessage((event) => {
      // Người bị khoanh phạm vi chỉ nhận sự kiện của nhóm mình (phase 4)
      if (principal.groupIds !== null && !principal.groupIds.includes(event.threadId)) return;
      response.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => response.write(": ping\n\n"), HEARTBEAT_MS);
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.on("close", close);
    response.on("close", close);
    // Không `end()` — kết nối sống tới khi trình duyệt đóng; router không đụng tới response nữa
  }],
];
