import type { FunctionDeclaration } from "../assistant/gemini-client.js";
import { MAX_REMINDER_TITLE_CHARS, MAX_TARGETS } from "./send-command-limits.js";

// Khai báo hàm cho mô hình của hai công cụ đề xuất đã chuyển sang MCP (`propose_send_message`, `propose_group_reminder`). Tệp LÁ: lõi
// (`data-access/send/`) lấy mô tả từ đây để khai báo của mô hình KHÔNG đổi (T3); tệp công cụ cũ re-export tên cũ.

export const PROPOSE_SEND_DECLARATION: FunctionDeclaration = {
  name: "propose_send_message",
  description:
    "Tạo NHÁP lệnh gửi tin Zalo từ bot tới nhóm / người nội bộ khi người hỏi RA LỆNH gửi. Chỉ đề xuất — hệ thống tự dựng bản xem trước " +
    "và người hỏi phải nhắn «đồng ý» mới gửi. Chỉ dùng khi người hỏi đang ra lệnh gửi, không dùng khi họ chỉ hỏi.",
  parameters: {
    type: "object",
    properties: {
      targets: { type: "array", items: { type: "string" }, description: `Tên nơi nhận, chép nguyên văn từ tin của người hỏi (tối đa ${MAX_TARGETS})` },
      content: { type: "string", description: "Nội dung cần gửi, chép NGUYÊN VĂN từ tin của người hỏi, không thêm / sửa chữ" },
      schedule: { type: "string", description: "Giờ hẹn gửi nếu có, vd «8h sáng mai»; bỏ trống = gửi ngay sau khi xác nhận" },
      with_recent_files: { type: "boolean", description: "true = gửi kèm tệp / ảnh người hỏi vừa gửi bot (trong 10 phút)" },
    },
    required: ["targets", "content"],
  },
};

export const PROPOSE_REMINDER_DECLARATION: FunctionDeclaration = {
  name: "propose_group_reminder",
  description:
    "Tạo NHÁP nhắc hẹn Zalo cho một hay nhiều NHÓM nội bộ (từ tin riêng). Chỉ đề xuất — hệ thống tự dựng bản xem trước và người hỏi " +
    "phải nhắn «đồng ý» mới tạo. Chỉ cho nhóm, không cho từng người.",
  parameters: {
    type: "object",
    properties: {
      groups: { type: "array", items: { type: "string" }, description: `Tên nhóm, chép nguyên văn từ tin của người hỏi (tối đa ${MAX_TARGETS})` },
      title: { type: "string", description: `Nội dung nhắc, ngắn gọn, tối đa ${MAX_REMINDER_TITLE_CHARS} ký tự, vd 'Họp giao ban tuần'` },
      start_time: { type: "string", description: "Thời điểm nhắc, ISO 8601 có +07:00, vd 2026-10-13T08:00:00+07:00" },
      repeat: { type: "string", enum: ["none", "daily", "weekly", "monthly"], description: "Lặp lại; mặc định none" },
    },
    required: ["groups", "title", "start_time"],
  },
};
