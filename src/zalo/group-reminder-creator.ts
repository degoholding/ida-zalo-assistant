import { ThreadType, type API } from "zca-js";
import type { ZaloSender } from "./zalo-sender.js";

// Tạo MỘT nhắc hẹn Zalo cho nhóm từ job lệnh gửi (nhắc hẹn nhóm từ tin riêng). Đi qua `ZaloSender` — có giãn cách và bị chặn
// khi bot tắt khẩn (BotHaltedError), cùng khuôn `group-assistant-replier.buildActions`.

export interface GroupReminderRequest {
  title: string;
  /** Mili-giây epoch */
  startTime: number;
  /** 0 không lặp · 1 ngày · 2 tuần · 3 tháng */
  repeat: 0 | 1 | 2 | 3;
}

/**
 * `checkExisting` = true ở lượt thử lại: lượt trước có thể đã tạo xong mà lỗi mạng làm mất kết quả, nên xem nhóm đã có nhắc hẹn
 * cùng tiêu đề + giờ chưa — có rồi thì thôi, không tạo trùng. Trả mã nhắc hẹn (hoặc của bản có sẵn).
 */
export async function createGroupReminder(
  api: API, sender: ZaloSender, zaloGroupId: string, request: GroupReminderRequest, checkExisting: boolean,
): Promise<string> {
  if (checkExisting) {
    const existing = await api.getListReminder({ count: 50 }, zaloGroupId, ThreadType.Group);
    const same = existing.find((item) => Number(item.startTime) === request.startTime && (item.params?.title ?? "") === request.title);
    if (same) return String(same.id ?? same.reminderId);
  }
  // Chỉ đưa đúng ba trường Zalo cần — nơi gọi có thể truyền đối tượng rộng hơn (threadId, checkExisting…)
  const { title, startTime, repeat } = request;
  const created = await sender.send(() => api.createReminder({ title, startTime, repeat }, zaloGroupId, ThreadType.Group));
  return String("id" in created ? created.id : created.reminderId);
}
