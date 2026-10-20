import { ContactRole } from "../constants.js";
import { SEND_HELP } from "../send-commands/send-command-help.js";
import type { AlertAsker } from "./alert-tools.js";
import { REPLY_METRIC_HELP } from "./reply-metric-help.js";

// Văn bản «hướng dẫn» của lệnh gõ: thay đổi theo người hỏi (vai trò, người nhận, người xử lý ticket, được ra lệnh gửi) và nơi hỏi (nhóm / riêng).

const canChangeGlobal = (asker: AlertAsker | null) => asker?.role === ContactRole.Manager || asker?.role === ContactRole.DepartmentHead;

const TICKET_HELP = [
  "BÁO TICKET (việc cần hỗ trợ, lỗi, sự cố):",
  "- báo lỗi: <nội dung> — có ảnh thì gửi ảnh TRƯỚC rồi nhắn",
  "- ticket — xem các ticket của anh/chị",
  "- T-12 — xem tình hình ticket T-12",
  "- T-12: <bổ sung> — thêm nội dung / ảnh cho ticket",
  "- xong T-12 — tự báo đã ổn (đóng ticket); hủy T-12 — hủy ticket báo nhầm",
];

const TASK_HELP = [
  "VIỆC (checklist, bot nhắc theo hạn):",
  "- việc — việc anh/chị đang phụ trách / đã giao; việc quá hạn",
  "- giao Minh: <việc> hạn <thứ 6 / 20/10 / mai 17h> — giao việc (trong nhóm thì bot tag người đó)",
  "- xong V-12 <ghi chú> — báo đã xong (bot báo người giao)",
  "- dời V-12 <hạn> · giao lại V-12 <tên> · hủy V-12 · V-12: <ghi chú> · V-12 — xem",
];

/** Người chỉ dùng được lệnh ticket / việc được giao (chưa có vai trò): chỉ lệnh của người phụ trách */
const TASK_ASSIGNEE_HELP = [
  "VIỆC ĐƯỢC GIAO:",
  "- việc — các việc anh/chị đang phụ trách",
  "- xong V-12 <ghi chú> — báo đã xong · V-12: <ghi chú> — nhắn người giao",
];

const TICKET_HANDLER_HELP = [
  "XỬ LÝ TICKET (người xử lý):",
  "- ticket — các ticket đang mở",
  "- nhận T-12 — nhận xử lý (bot báo người gửi)",
  "- xong T-12 <ghi chú> — báo đã xong",
  "- T-12: <nội dung> — nhắn người gửi",
];

export function buildHelpText(asker: AlertAsker | null, inGroup: boolean, options: { ticketOnly?: boolean; ticketHandler?: boolean; canSend?: boolean } = {}): string {
  const ticketLines = ["", ...TASK_HELP, "", ...TICKET_HELP, ...(options.ticketHandler ? ["", ...TICKET_HANDLER_HELP] : [])];
  if (options.ticketOnly) return ["HƯỚNG DẪN DÙNG BOT TRỢ LÝ", ...TASK_ASSIGNEE_HELP, "", ...TICKET_HELP, ...(options.ticketHandler ? ["", ...TICKET_HANDLER_HELP] : [])].join("\n");
  if (inGroup) {
    return [
      "HƯỚNG DẪN DÙNG BOT TRONG NHÓM",
      "Gọi tên bot rồi nói việc cần làm, ví dụ:",
      "- Tóm tắt nhóm hôm nay / tuần này",
      "- Đọc file này / đọc link này giúp anh",
      "- Xuất PDF tóm tắt / xuất Excel báo cáo tuần",
      "- Nhắc cả nhóm 8h30 sáng mai họp giao ban",
      "- Ghim nội dung … / tạo bình chọn …",
      "- Tạo cuộc họp Meet 9h sáng mai",
      "Muốn xem tin cần xử lý hay đổi cấu hình cảnh báo thì nhắn RIÊNG cho bot.",
      "",
      "BÁO TICKET: gọi tên bot rồi «báo lỗi: <nội dung>» (có ảnh thì gửi ảnh trước).",
      "VIỆC: gọi tên bot rồi «giao Minh: <việc> hạn thứ 6», «việc nhóm», «xong V-12».",
    ].join("\n");
  }
  const lines = [
    "HƯỚNG DẪN DÙNG BOT TRỢ LÝ",
    "Hỏi bằng câu bình thường, ví dụ:",
    "- Tóm tắt nhóm Bán hàng hôm nay",
    "- Hôm qua anh Nam trao đổi gì",
    "- Tìm file báo giá tháng 9 / đọc file này",
    "- Xuất Excel báo cáo các nhóm tuần này",
    "- Đọc link này giúp anh <dán link>",
    "- Tạo cuộc họp Meet 9h sáng mai với …",
  ];
  if (asker) {
    lines.push("", "CẢNH BÁO TIN NHẮN (gõ đúng lệnh, có dấu hay không dấu đều được):",
      "- cần xử lý — tin KHẨN và tin đang chờ trả lời",
      "- xong 1234 — đánh dấu tin số 1234 đã xử lý (số lấy từ danh sách trên)",
      "- cấu hình — xem cấu hình cảnh báo đang dùng");
    if (asker.recipientId) {
      lines.push("- thêm vip <tên> / bỏ vip <tên> — VIP của riêng anh/chị");
      lines.push("", "BẢN TIN, BÁO CÁO (gọi ngay, không cần chờ giờ hẹn):",
        "- bản tin sáng / bản tin cuối ngày — xem lại bản tin của hôm nay",
        "- báo cáo tuần / báo cáo tháng (thêm «trước» hoặc «này» để chọn kỳ) — PDF + Excel gửi kèm");
    }
    if (canChangeGlobal(asker)) {
      lines.push("", "ĐỔI CẤU HÌNH CHUNG (quản lý / trưởng phòng):",
        "- thêm từ khẩn <từ> / bỏ từ khẩn <từ>",
        "- thêm từ quan trọng <từ> / bỏ từ quan trọng <từ>",
        "- phút chờ 120 — chưa ai trả lời sau 120 phút làm việc thì nhắc",
        "- phút chờ vip 30 — như trên cho tin của VIP");
    }
    lines.push("", "Lệnh đổi cấu hình: em đọc lại thay đổi, anh/chị nhắn «đồng ý» mới lưu, «hủy» để bỏ.");
  }
  if (asker) lines.push("", ...REPLY_METRIC_HELP);
  if (options.canSend) lines.push("", ...SEND_HELP);
  lines.push(...ticketLines);
  return lines.join("\n");
}
