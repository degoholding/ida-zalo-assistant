import type { FunctionDeclaration } from "./gemini-client.js";

// Công cụ recap_drive_recording (phase 6, 10/10/2026): recap cuộc họp khi người hỏi KHÔNG gửi file ghi âm / link trong
// chat — tìm trong thư mục Drive «Ghi âm họp» của công ty (Cài đặt → Google), tạo / dùng lại đúng dòng
// `meeting_recording`, rồi để việc nền (1 phút/lần) gỡ băng như recap tự động. Nghiệp vụ thật nằm ở
// src/meetings/meeting-recap-ondemand.ts; closure thật (đọc cấu hình Drive hiện hành + đẩy PDF resend vào
// `reportFiles`) gắn ở assistant-service.ts (ToolContext.onDemandRecap), cùng khuôn với create_meeting_recap_pdf.

export type RecapDriveRecording = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

export const RECAP_DRIVE_RECORDING_DECLARATION: FunctionDeclaration = {
  name: "recap_drive_recording",
  description:
    "Recap một cuộc họp từ GHI ÂM TRONG THƯ MỤC DRIVE của công ty (không phải tệp người hỏi vừa gửi trong chat / link). " +
    "Dùng khi người hỏi muốn recap cuộc họp nhưng KHÔNG gửi kèm ghi âm / link. Không nói tên tệp → để trống, bot lấy ghi âm " +
    "MỚI NHẤT trong 7 ngày. Có nói tên → truyền name để tìm gần đúng. Công cụ trả 'candidates' khi có vài ghi âm giống tên — " +
    "liệt kê (tên, giờ tải lên) rồi HỎI LẠI người dùng, lần sau gọi lại kèm file_id đã chọn. Trả 'reply' thì nói lại ĐÚNG " +
    "NGUYÊN VĂN câu đó (đã bắt đầu xử lý / đang xử lý / gửi lại recap cũ), không soạn lại.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Một phần tên tệp ghi âm, vd 'giao ban k52' (tùy chọn — để trống lấy ghi âm mới nhất)" },
      file_id: { type: "string", description: "Mã tệp Drive đã biết chắc (vd người dùng vừa chọn từ danh sách 'candidates' ở lượt trước)" },
    },
  },
};

export async function runRecapDriveRecording(run: RecapDriveRecording | undefined, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!run) return { error: "Recap ghi âm từ Drive chưa bật — chưa cấu hình thư mục hoặc chưa có quyền đọc Drive." };
  return run(args);
}
