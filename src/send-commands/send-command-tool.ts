// Công cụ AI `propose_send_message` (phase 9) — cho câu ra lệnh gửi tin mà parser lệnh gõ không khớp («nhờ em nhắc nhóm kho chiều nay họp nhé»).
// CHỈ ĐỀ XUẤT: tạo NHÁP rồi câu trả lời của lượt là bản xem trước do MÁY CHỦ dựng (`fixedReply`), mô hình không viết lại được. Nội dung + tên nơi
// nhận phải nguyên văn trong tin của người hỏi; việc xác nhận chỉ qua lệnh gõ «đồng ý» — mô hình không có công cụ xác nhận.
// Phase 12: khai báo + lời nhắc là tệp lá (`send-tool-*.ts`); họ `send` bật thì công cụ lõi cùng tên chạy qua MCP, tắt thì executor cũ ở `-legacy`.
export { SEND_TOOL_PROMPT } from "./send-tool-prompts.js";
export { PROPOSE_SEND_DECLARATION } from "./send-tool-declarations.js";
export { runProposeSendTool, type ProposeSendOutcome } from "./send-command-tool-legacy.js";
