// Công cụ AI `propose_group_reminder` — tạo NHẮC HẸN Zalo cho nhóm TỪ TIN RIÊNG. Khuôn y hệt `propose_send_message`: chỉ tạo NHÁP, câu trả lời của
// lượt là bản xem trước do MÁY CHỦ dựng, việc tạo thật chỉ xảy ra khi người dùng nhắn «đồng ý». Bình chọn / bỏ ghim / hủy nhắc hẹn từ tin riêng →
// «gọi em trong nhóm đó»: nằm ở no-fake-action-prompt.ts. Khai báo + lời nhắc ở tệp lá; executor cũ ở `-legacy` (họ `send` bật thì công cụ lõi chạy).
export { REMINDER_TOOL_PROMPT } from "./send-tool-prompts.js";
export { PROPOSE_REMINDER_DECLARATION } from "./send-tool-declarations.js";
export { runProposeReminderTool } from "./send-reminder-tool-legacy.js";
