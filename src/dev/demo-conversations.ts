// Dữ liệu mẫu cho máy dev (`npm run seed:demo`): người, công ty, nhóm và tin nhắn công việc tiếng Việt,
// đủ để bấm thử mọi màn và hỏi trợ lý («tóm tắt nhóm K52 hôm nay», «tìm file báo giá»…). Mọi mã Zalo bắt
// đầu bằng `demo-` để nhận ra và không đụng dữ liệu thật. Giờ gửi tính lùi từ lúc chạy (`hoursAgo`).

export interface DemoPerson {
  uid: string;
  name: string;
}

export interface DemoMessage {
  hoursAgo: number;
  from: keyof typeof DEMO_PEOPLE;
  text?: string;
  /** Tin gửi tệp — chỉ lưu tên / cỡ, không có tệp thật (nhóm demo tắt «Lấy file»). */
  file?: { name: string; bytes: number };
}

export interface DemoGroup {
  zaloId: string;
  name: string;
  companyCode: string;
  members: (keyof typeof DEMO_PEOPLE)[];
  messages: DemoMessage[];
}

export const DEMO_BOT = { label: "demo-bot", uid: "demo-bot-uid", name: "Bot trợ lý (demo)" };

export const DEMO_PEOPLE = {
  duy: { uid: "demo-u-duy", name: "Nguyễn Văn Duy" },
  lan: { uid: "demo-u-lan", name: "Trần Thị Lan" },
  hung: { uid: "demo-u-hung", name: "Lê Minh Hùng" },
  mai: { uid: "demo-u-mai", name: "Phạm Thu Mai" },
  tuan: { uid: "demo-u-tuan", name: "Đỗ Anh Tuấn" },
  hoa: { uid: "demo-u-hoa", name: "Vũ Thị Hoa" },
} satisfies Record<string, DemoPerson>;

/** Người hỏi bot: được cấp vai trò Quản lý, `npm run ask` nhắn dưới tên người này. */
export const DEMO_MANAGER = DEMO_PEOPLE.duy;

export const DEMO_COMPANIES = [
  { code: "DEMO-KT", name: "Công ty Kế toán Demo" },
  { code: "DEMO-XD", name: "Công ty Xây dựng Demo" },
];

export const DEMO_GROUPS: DemoGroup[] = [
  {
    zaloId: "demo-g-k52",
    name: "DEMO · Công trình K52",
    companyCode: "DEMO-XD",
    members: ["duy", "hung", "mai", "tuan"],
    messages: [
      { hoursAgo: 50, from: "hung", text: "Báo cáo sáng: tầng 5 đổ bê tông xong 80%, chiều nay xong phần còn lại." },
      { hoursAgo: 49, from: "duy", text: "Ok em. Nhớ chụp ảnh nghiệm thu cốt thép trước khi đổ nhé." },
      { hoursAgo: 46, from: "mai", text: "Thép phi 16 còn đủ dùng 3 ngày, em đang chờ NCC Thép Việt báo giá đợt mới." },
      { hoursAgo: 30, from: "hung", text: "Sáng nay mưa to, tạm dừng đổ bê tông tầng 6. Dự kiến chậm 1 ngày." },
      { hoursAgo: 29, from: "duy", text: "Chậm 1 ngày thì được, nhưng anh cần tiến độ cập nhật trước thứ 6 để báo chủ đầu tư." },
      { hoursAgo: 28, from: "tuan", text: "Chủ đầu tư hỏi có xong phần thô trước 30/10 được không ạ?" },
      { hoursAgo: 27, from: "hung", text: "Nếu không mưa thêm thì kịp, em sẽ gửi bảng tiến độ chi tiết." },
      { hoursAgo: 8, from: "hung", file: { name: "Tien-do-K52-tuan-40.pdf", bytes: 842_000 } },
      { hoursAgo: 7, from: "hung", text: "Em gửi tiến độ tuần 40. Vấn đề chính: thiếu 2 thợ hàn, cần bổ sung gấp." },
      { hoursAgo: 6, from: "duy", text: "Mai liên hệ đội thợ bên anh Tuấn giới thiệu xem có người không nhé." },
      { hoursAgo: 5, from: "mai", text: "Dạ em gọi rồi, mai họ báo lại. Còn thép phi 16 em sẽ chốt đơn trong hôm nay." },
      { hoursAgo: 2, from: "hung", text: "Chiều nay đổ xong tầng 6. Ngày mai bắt đầu lắp cốp pha tầng 7." },
    ],
  },
  {
    zaloId: "demo-g-ketoan",
    name: "DEMO · Kế toán nội bộ",
    companyCode: "DEMO-KT",
    members: ["duy", "lan", "tuan", "mai"],
    messages: [
      { hoursAgo: 52, from: "lan", text: "Nhắc mọi người nộp chứng từ tạm ứng tháng 9 trước ngày 5/10 nhé." },
      { hoursAgo: 51, from: "tuan", text: "Em còn 2 hóa đơn tiếp khách chưa có VAT, chị cho em khất tới thứ 2." },
      { hoursAgo: 50, from: "lan", text: "Ok Tuấn, thứ 2 là hạn cuối nha." },
      { hoursAgo: 26, from: "lan", file: { name: "Bao-cao-cong-no-thang-9.xlsx", bytes: 126_000 } },
      { hoursAgo: 26, from: "lan", text: "Gửi anh Duy báo cáo công nợ tháng 9. Khách hàng Minh Phát còn nợ 420 triệu, quá hạn 45 ngày." },
      { hoursAgo: 24, from: "duy", text: "Tuấn gọi Minh Phát hỏi lịch thanh toán, cuối tuần báo anh." },
      { hoursAgo: 23, from: "tuan", text: "Dạ, em hẹn được thứ 5 gặp kế toán bên đó." },
      { hoursAgo: 10, from: "mai", text: "Chị Lan ơi, đơn thép K52 đợt này khoảng 1,2 tỷ, chị chuẩn bị dòng tiền giúp em." },
      { hoursAgo: 9, from: "lan", text: "Tuần này chỉ chi được tối đa 800 triệu, phần còn lại tuần sau. Mai xin NCC cho trả 2 đợt nhé." },
      { hoursAgo: 3, from: "lan", text: "Lương tháng 9 đã chuyển xong, ai chưa nhận báo chị." },
    ],
  },
  {
    zaloId: "demo-g-ncc",
    name: "DEMO · Mua thép - NCC Thép Việt",
    companyCode: "DEMO-XD",
    members: ["duy", "mai", "hoa"],
    messages: [
      { hoursAgo: 45, from: "mai", text: "Chị Hoa báo giá giúp em thép phi 16 và phi 20, khoảng 60 tấn, giao công trình K52." },
      { hoursAgo: 40, from: "hoa", file: { name: "Bao-gia-thep-Viet-T10.pdf", bytes: 310_000 } },
      { hoursAgo: 40, from: "hoa", text: "Em gửi báo giá tháng 10: phi 16 là 15,2 triệu/tấn, phi 20 là 15,4 triệu/tấn, chưa VAT." },
      { hoursAgo: 39, from: "duy", text: "Giá tăng 3% so với tháng trước. Chị Hoa giảm được không, bên anh lấy đều hàng tháng." },
      { hoursAgo: 20, from: "hoa", text: "Em xin sếp được giảm 1% nếu chốt trong tuần và thanh toán 2 đợt." },
      { hoursAgo: 4, from: "mai", text: "Dạ bên em chốt 60 tấn, trả 2 đợt: 800 triệu tuần này, còn lại tuần sau. Chị gửi hợp đồng giúp em." },
      { hoursAgo: 1, from: "hoa", text: "Ok em, chiều nay chị gửi hợp đồng. Giao hàng sáng thứ 7 được không?" },
    ],
  },
];
