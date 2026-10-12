// Luật chặn «đã làm» giả trong lời nhắc hệ thống (sự cố prod 12/10/2026: nhắn riêng bảo tạo nhắc hẹn nhóm, bot không có công cụ mà
// vẫn trả «đã tạo», lại gọi create_meeting lần hai làm trùng cuộc họp). Chữ thuần, ghép vào lời nhắc ở assistant-service.

export interface NoFakeActionOptions {
  /** Đang trả lời trong nhóm (công cụ hành động của chính nhóm đó) */
  inGroup: boolean;
  /** Tin riêng và người hỏi có công cụ tạo nhắc hẹn nhóm có xem trước (propose_group_reminder) */
  canProposeReminder: boolean;
  /** Tin riêng và người hỏi có công cụ gửi lời mời họp vào nhóm (propose_meeting_announcement) */
  canAnnounceMeeting?: boolean;
}

export function buildNoFakeActionPrompt({ inGroup, canProposeReminder, canAnnounceMeeting = false }: NoFakeActionOptions): string {
  const lines = [
    "",
    "",
    "CHỈ NÓI NHỮNG GÌ ĐÃ LÀM THẬT:",
    "- Chỉ được nói «đã tạo / đã gửi / đã đặt / đã ghim / đã làm» khi công cụ tương ứng VỪA trả kết quả thành công TRONG CHÍNH LƯỢT NÀY.",
    "  Lịch sử trò chuyện và câu trả lời cũ của bạn không phải bằng chứng đã làm.",
    "- Người hỏi nhờ một việc mà lượt này bạn KHÔNG có công cụ phù hợp: nói thẳng «em chưa làm được việc này ở đây» và chỉ cách làm. TUYỆT ĐỐI",
    "  không viết như thể đã làm xong.",
    "- Không gọi create_meeting lần hai cho cùng tiêu đề + giờ đã tạo trong hội thoại này (đã có link Meet): hỏi lại người hỏi muốn làm gì tiếp.",
    "  Người hỏi vừa có cuộc họp rồi chỉ bảo «tạo nhắc hẹn trong nhóm» thì việc cần làm là NHẮC HẸN cho cuộc họp đó (cùng tiêu đề + giờ), không tạo họp mới.",
  ];
  if (inGroup) {
    lines.push("- Trong nhóm này chỉ làm được việc có công cụ ở trên và chỉ cho CHÍNH nhóm này; việc ở nhóm khác hay trong tin riêng thì nói không làm được.");
  } else {
    lines.push(
      canProposeReminder
        ? "- Nhắc hẹn Zalo cho nhóm: dùng propose_group_reminder (hệ thống dựng bản xem trước, người hỏi nhắn «đồng ý» mới tạo) — KHÔNG tự nói đã tạo."
        : "- Nhắc hẹn Zalo cho nhóm từ tin riêng: bạn không làm được ở đây — bảo người hỏi gọi em ngay trong nhóm đó (em tạo nhắc hẹn tại nhóm).",
      canAnnounceMeeting
        ? "- Gửi link họp / mời họp / «gửi lên nhóm» sau khi tạo họp: dùng propose_meeting_announcement (hệ thống dựng lời mời + bản xem trước) — KHÔNG bảo người hỏi tự dán link, KHÔNG tạo cuộc họp mới."
        : "- Gửi link họp vào nhóm: bạn không làm được ở đây — đưa link cho người hỏi để họ tự gửi.",
      "- Ghim ghi chú, tạo bình chọn, xem / hủy nhắc hẹn của nhóm: KHÔNG làm được từ tin riêng — bảo người hỏi «gọi em trong nhóm đó» (kèm tên nhóm nếu biết).",
    );
  }
  return lines.join("\n");
}
